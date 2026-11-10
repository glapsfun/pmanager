import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { gitOk } from "./git";
import type { Catalog } from "./projects";
import { replaceBetweenMarkers } from "./render";

export type Role = "check" | "deploy" | "release" | "forbidden";

export interface Command {
  text: string;
  role: Role;
  /** `path:line` in the project's checkout */
  source: string;
}

export interface Part {
  /** "" for the repo root */
  folder: string;
  stacks: string[];
  commands: Command[];
}

export interface LinkEnd {
  folder: string;
  file: string;
  line: number;
  key: string;
}

export interface Link {
  value: string;
  source: LinkEnd;
  consumer: LinkEnd;
  release: boolean;
}

export interface Profile {
  revision: string;
  parts: Part[];
  links: Link[];
  /** files skipped, and why */
  notes: string[];
}

const STACKS: [RegExp, string][] = [
  [/(^|\/)go\.mod$/, "go"],
  [/\.tf$/, "terraform"],
  [/(^|\/)Chart\.yaml$/, "helm"],
  [/(^|\/)kustomization\.ya?ml$/, "kustomize"],
  [/(^|\/)package\.json$/, "node"],
  [/(^|\/)pyproject\.toml$/, "python"],
  [/(^|\/)Cargo\.toml$/, "rust"],
];
const TOOLS = new Set(
  "make go terraform tflint checkov helm ct kubectl kubeconform yamllint npm pnpm yarn bun cargo pytest uv docker git golangci-lint python pip".split(
    " ",
  ),
);
const NEGATION = /\b(?:never|do not|don't|must not|avoid)\b/i;
const DEPLOY = /^(?:terraform (?:plan|apply)|helm (?:upgrade|install)|kubectl (?:apply|rollout))\b/;
const RELEASE = /^(?:make release|docker push|git tag)\b|\bpublish\b/;
const VERSION = /^v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?$/;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const GITLAB_RESERVED = new Set([
  "stages",
  "variables",
  "include",
  "default",
  "workflow",
  "image",
  "services",
  "before_script",
  "after_script",
  "cache",
]);

function folderOf(file: string): string {
  const d = posix.dirname(file);
  return d === "." ? "" : d;
}

function inside(file: string, folder: string): boolean {
  return folder === "" || file.startsWith(`${folder}/`);
}

/** null for setup steps (a tool install), which are neither checks nor deploys. */
function roleOf(text: string, negated: boolean): Role | null {
  if (negated) return "forbidden";
  if (text.split(/\s+/).slice(1, 3).includes("install") && !DEPLOY.test(text)) return null;
  if (DEPLOY.test(text)) return "deploy";
  if (RELEASE.test(text)) return "release";
  return "check";
}

function isCommand(span: string): boolean {
  const first = span.trim().split(/\s+/)[0] ?? "";
  return first.startsWith("./") || TOOLS.has(first);
}

/** Paragraphs and list items, joined so a wrapped sentence keeps its negation. */
function blocks(raw: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let cur: string[] = [];
  let start = 0;
  raw.split("\n").forEach((l, i) => {
    const bullet = /^\s*(?:[-*]|\d+\.)\s/.test(l);
    if (l.trim() === "" || bullet || /^#/.test(l)) {
      if (cur.length) out.push({ text: cur.join("\n"), line: start });
      cur = [];
    }
    if (l.trim() === "") return;
    if (cur.length === 0) start = i + 1;
    cur.push(l);
  });
  if (cur.length) out.push({ text: cur.join("\n"), line: start });
  return out;
}

function docCommands(raw: string, file: string): Command[] {
  const out: Command[] = [];
  for (const b of blocks(raw)) {
    for (const m of b.text.matchAll(/`([^`\n]+)`/g)) {
      const span = (m[1] ?? "").trim();
      if (!isCommand(span)) continue;
      const at = m.index ?? 0;
      // The sentence holding the span, up to the span itself.
      const sentenceStart = Math.max(b.text.lastIndexOf(". ", at), b.text.lastIndexOf(".\n", at));
      const before = b.text.slice(sentenceStart < 0 ? 0 : sentenceStart + 1, at);
      const role = roleOf(span, NEGATION.test(before));
      if (!role) continue;
      const line = b.line + (b.text.slice(0, at).match(/\n/g)?.length ?? 0);
      out.push({ text: span, role, source: `${file}:${line}` });
    }
  }
  return out;
}

function globRe(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** GitHub semantics: patterns apply in order, a leading ! excludes again. */
function matches(file: string, patterns: string[]): boolean {
  let hit = false;
  for (const p of patterns) {
    const neg = p.startsWith("!");
    if (globRe(neg ? p.slice(1) : p).test(file)) hit = !neg;
  }
  return hit;
}

/** Which of the files a job's filters let through; null means no filter, every change. */
type Filter = { paths?: string[]; ignore?: string[] } | null;

function covers(filters: Filter[], files: string[]): boolean {
  return filters.some((f) => {
    if (f === null) return true;
    if (f.paths) return files.some((x) => matches(x, f.paths ?? []));
    return files.some((x) => !matches(x, f.ignore ?? []));
  });
}

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function lineOf(raw: string, text: string, from = 0): number {
  const lines = raw.split("\n");
  for (let i = from; i < lines.length; i++) if (lines[i]?.includes(text)) return i + 1;
  return 1;
}

interface Job {
  filters: Filter[];
  commands: Command[];
}

function ciCommands(raw: string, file: string, lines: string[]): Command[] {
  const out: Command[] = [];
  for (const l of lines.flatMap((x) => x.split("\n"))) {
    const text = l.trim();
    if (text === "" || text.startsWith("#")) continue;
    const role = roleOf(text, false);
    if (role) out.push({ text, role, source: `${file}:${lineOf(raw, text)}` });
  }
  return out;
}

function githubJobs(doc: Record<string, unknown>, raw: string, file: string): Job[] {
  const on = doc.on ?? doc.true;
  const filters: Filter[] = [];
  if (typeof on === "string" || Array.isArray(on)) filters.push(null);
  else if (on && typeof on === "object") {
    for (const ev of Object.values(on as Record<string, unknown>)) {
      const e = (ev ?? {}) as Record<string, unknown>;
      if (e.paths) filters.push({ paths: strings(e.paths) });
      else if (e["paths-ignore"]) filters.push({ ignore: strings(e["paths-ignore"]) });
      else filters.push(null);
    }
  }
  const jobs = (doc.jobs ?? {}) as Record<string, { steps?: { run?: unknown }[] }>;
  return Object.values(jobs).map((j) => ({
    filters,
    commands: ciCommands(
      raw,
      file,
      (j?.steps ?? []).flatMap((s) => strings(s?.run)),
    ),
  }));
}

function gitlabJobs(doc: Record<string, unknown>, raw: string, file: string): Job[] {
  const out: Job[] = [];
  for (const [name, v] of Object.entries(doc)) {
    if (GITLAB_RESERVED.has(name) || name.startsWith(".") || !v || typeof v !== "object") continue;
    const job = v as Record<string, unknown>;
    if (!("script" in job)) continue;
    const changes = [
      ...(Array.isArray(job.rules) ? job.rules : []).flatMap((r) =>
        strings((r as Record<string, unknown>)?.changes),
      ),
      ...strings(((job.only ?? {}) as Record<string, unknown>).changes),
    ];
    out.push({
      filters: changes.length > 0 ? [{ paths: changes }] : [null],
      commands: ciCommands(raw, file, strings(job.script)),
    });
  }
  return out;
}

function parseYaml(raw: string, file: string, notes: string[]): Record<string, unknown> | null {
  try {
    const doc = Bun.YAML.parse(raw);
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch (e) {
    notes.push(`${file}: not valid YAML (${(e as Error).message.split("\n")[0]})`);
    return null;
  }
}

interface Literal {
  value: string;
  file: string;
  line: number;
  key: string;
}

function linkable(v: unknown): v is string {
  if (typeof v !== "string" || /\s/.test(v) || v === "true" || v === "false") return false;
  if (/^\d+$/.test(v)) return false;
  return v.length >= 6 || VERSION.test(v);
}

function flatten(v: unknown, prefix: string, out: [string, unknown][]): void {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out.push([prefix, v]);
}

function literals(raw: string, file: string, notes: string[]): Literal[] {
  const base = posix.basename(file);
  const out: Literal[] = [];
  if (file.endsWith(".tf")) {
    raw.split("\n").forEach((l, i) => {
      const m = /^\s*([\w-]+)\s*=\s*"([^"]*)"/.exec(l);
      if (m && linkable(m[2])) out.push({ value: m[2], file, line: i + 1, key: m[1] ?? "" });
    });
  } else if (base === "Makefile") {
    raw.split("\n").forEach((l, i) => {
      const m = /^([A-Z][A-Z0-9_]*)\s*:?=\s*(\S+)\s*$/.exec(l);
      if (m && linkable(m[2])) out.push({ value: m[2], file, line: i + 1, key: m[1] ?? "" });
    });
  } else if (/^values.*\.ya?ml$/.test(base) || /^kustomization\.ya?ml$/.test(base)) {
    const doc = parseYaml(raw, file, notes);
    if (!doc) return out;
    const pairs: [string, unknown][] = [];
    if (base.startsWith("kustomization")) {
      for (const img of Array.isArray(doc.images) ? doc.images : []) {
        const i = img as Record<string, unknown>;
        pairs.push([`images.${String(i.name)}.newTag`, i.newTag]);
      }
    } else flatten(doc, "", pairs);
    for (const [key, v] of pairs) {
      if (!linkable(v)) continue;
      const leaf = key.split(".").pop() ?? key;
      out.push({ value: v, file, line: lineOf(raw, `${leaf}:`), key });
    }
  }
  return out;
}

const isDeployConfig = (file: string) =>
  /^(?:values.*|kustomization)\.ya?ml$/.test(posix.basename(file));

export async function extractProfile(checkout: string): Promise<Profile> {
  const files = (await gitOk(["ls-files"], checkout)).split("\n").filter(Boolean);
  const revision = (await gitOk(["rev-parse", "HEAD"], checkout)).trim();
  const notes: string[] = [];
  const folders = [
    ...new Set(files.filter((f) => STACKS.some(([re]) => re.test(f))).map(folderOf)),
  ].sort();
  const partOf = (file: string): string | null =>
    folders.filter((f) => inside(file, f)).sort((a, b) => b.length - a.length)[0] ?? null;
  const parts: Part[] = folders.map((folder) => ({
    folder,
    stacks: [
      ...new Set(
        files
          .filter((f) => folderOf(f) === folder)
          .flatMap((f) => STACKS.filter(([re]) => re.test(f)).map(([, s]) => s)),
      ),
    ],
    commands: [],
  }));
  const read = (f: string) => readFile(join(checkout, f), "utf8").catch(() => "");
  const add = (part: Part, cs: Command[]) => {
    for (const c of cs) {
      if (!part.commands.some((x) => x.text === c.text && x.role === c.role)) part.commands.push(c);
    }
  };

  for (const part of parts) {
    for (const name of ["AGENTS.md", "README.md"]) {
      const f = part.folder ? `${part.folder}/${name}` : name;
      if (files.includes(f)) add(part, docCommands(await read(f), f));
    }
  }

  const jobs: Job[] = [];
  for (const f of files.filter((x) => WORKFLOW.test(x))) {
    const raw = await read(f);
    const doc = parseYaml(raw, f, notes);
    if (doc) jobs.push(...githubJobs(doc, raw, f));
  }
  const gitlab = files.includes(".gitlab-ci.yml") ? [".gitlab-ci.yml"] : [];
  for (let i = 0; i < gitlab.length; i++) {
    const f = gitlab[i] as string;
    const raw = await read(f);
    const doc = parseYaml(raw, f, notes);
    if (!doc) continue;
    for (const inc of [doc.include].flat()) {
      const local =
        typeof inc === "string" ? inc : (inc as Record<string, unknown> | undefined)?.local;
      const path = typeof local === "string" ? local.replace(/^\//, "") : null;
      if (path && files.includes(path) && !gitlab.includes(path)) gitlab.push(path);
    }
    jobs.push(...gitlabJobs(doc, raw, f));
  }
  for (const part of parts) {
    const own = files.filter((f) => partOf(f) === part.folder);
    for (const j of jobs) if (covers(j.filters, own)) add(part, j.commands);
  }

  const found: (Literal & { folder: string })[] = [];
  for (const f of files) {
    const folder = partOf(f);
    if (folder === null) continue;
    for (const l of literals(await read(f), f, notes)) found.push({ ...l, folder });
  }
  const links: Link[] = [];
  for (const c of found.filter((x) => isDeployConfig(x.file))) {
    for (const s of found) {
      if (s.value !== c.value || s.folder === c.folder || isDeployConfig(s.file)) continue;
      const release =
        VERSION.test(c.value) &&
        posix.basename(s.file) === "Makefile" &&
        /(?:^|\.)(?:tag|newTag)$/.test(c.key);
      const end = (x: Literal & { folder: string }): LinkEnd => ({
        folder: x.folder,
        file: x.file,
        line: x.line,
        key: x.key,
      });
      links.push({ value: c.value, source: end(s), consumer: end(c), release });
    }
  }
  return { revision, parts, links, notes };
}

export function partId(projectId: string, folder: string): string {
  return folder ? `${projectId}/${folder}` : projectId;
}

/** The words a task must contain for a command to count as named. */
function head(text: string): string {
  const t = text.trim().split(/\s+/);
  const first = t[0] ?? "";
  if (first.includes("/")) return posix.basename(first);
  const second = t[1];
  if (!second || second.startsWith("-") || second.includes("/") || second.startsWith("."))
    return first;
  return second === "run" && t[2] ? `${first} run ${t[2]}` : `${first} ${second}`;
}

export function namesCommand(text: string, c: Command): boolean {
  const h = head(c.text)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\w-])${h}($|[^\\w-])`, "i").test(text);
}

export const PARTS_START = "<!-- pm:parts:start -->";
export const PARTS_END = "<!-- pm:parts:end -->";

/** The generated section, markers included; only its json block is read back. */
export function renderProfileSection(projectId: string, p: Profile): string {
  const lines = [
    PARTS_START,
    "## Parts",
    "",
    `Extracted by pm from \`${p.revision.slice(0, 7)}\`; \`pm project refresh ${projectId}\` rewrites this section, never edit it by hand.`,
    "",
  ];
  if (p.parts.length === 0) lines.push("No parts found.", "");
  for (const part of p.parts) {
    lines.push(`- \`${partId(projectId, part.folder)}\` (${part.stacks.join(", ") || "no stack"})`);
    for (const c of part.commands) lines.push(`  - ${c.role}: \`${c.text}\` (${c.source})`);
  }
  if (p.links.length > 0) {
    lines.push("", "Links:", "");
    for (const l of p.links) {
      const kind = l.release ? "release link" : "link";
      lines.push(
        `- ${kind} \`${l.value}\`: ${l.source.file}:${l.source.line} \`${l.source.key}\` to ${l.consumer.file}:${l.consumer.line} \`${l.consumer.key}\``,
      );
    }
  }
  for (const n of p.notes) lines.push(`- skipped ${n}`);
  lines.push("", "```json", JSON.stringify(p), "```", PARTS_END);
  return `${lines.join("\n")}\n`;
}

export function readProfile(raw: string): Profile | null {
  const start = raw.indexOf(PARTS_START);
  const end = raw.indexOf(PARTS_END);
  if (start < 0 || end < start) return null;
  const block = /```json\n([\s\S]*?)\n```/.exec(raw.slice(start, end))?.[1];
  if (!block) return null;
  try {
    const p = JSON.parse(block) as Profile;
    return Array.isArray(p.parts) && Array.isArray(p.links) && typeof p.revision === "string"
      ? p
      : null;
  } catch {
    return null;
  }
}

/** Replaces the section, or puts it before the user's Notes, which it never touches. */
export function withProfile(raw: string, projectId: string, p: Profile): string {
  const section = renderProfileSection(projectId, p);
  const replaced = replaceBetweenMarkers(raw, PARTS_START, PARTS_END, section);
  if (replaced !== null) return replaced;
  const notes = raw.indexOf("\n## Notes");
  return notes < 0
    ? `${raw.trimEnd()}\n\n${section}`
    : `${raw.slice(0, notes + 1)}${section}\n${raw.slice(notes + 1)}`;
}

export async function loadProfiles(catalog: Catalog): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  for (const project of catalog.projects) {
    const p = readProfile(await readFile(project.file, "utf8").catch(() => ""));
    if (p) out.set(project.id, p);
  }
  return out;
}
