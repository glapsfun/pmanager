import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { git, gitOk } from "./git";
import { extractImages, type ImageRelease, type TagSetting } from "./images";
import type { Catalog } from "./projects";
import { replaceBetweenMarkers } from "./render";

export type Role = "check" | "deploy" | "release" | "forbidden";

export interface Command {
  text: string;
  role: Role;
  /** `path:line` in the project's checkout */
  source: string;
  /** For `make <target>`: what the part's Makefile recipe runs, so a task may name either. */
  runs?: string[];
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
  /** PROFILE_FORMAT when stored; older profiles lack what research and check now read. */
  format?: number;
  parts: Part[];
  links: Link[];
  /** files skipped, and why */
  notes: string[];
  /** repo-wide commands: CI jobs with no path filter, and root docs when the root is not a part */
  shared: Command[];
  /** the images this repo pushes, and on what */
  releases: ImageRelease[];
  /** the places this repo sets an image's tag */
  tagSettings: TagSetting[];
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
// A command's first word; anything else (shell keywords, heredoc bodies, `git clone`) is not a check.
const TOOLS = new Set(
  "make go terraform tflint checkov helm ct kubectl kubeconform kustomize yamllint shellcheck hadolint npm npx pnpm yarn bun deno node cargo pytest tox nox ruff mypy uv poetry python pip docker golangci-lint eslint prettier jest vitest mvn gradle dotnet just task bundle rake rspec composer phpunit pre-commit".split(
    " ",
  ),
);
// Forbidden only when the negation governs the span itself: "never run `a` or `b`", not
// "never push without running `a`" or "do not forget `a`".
const GOVERNS =
  /\b(?:never|do not|don't|must not|avoid)\s+(?:(?:run|running|use|using|call|calling|execute|invoke)\s+)?(?:`[^`]*`\s*(?:,|or|and|nor)\s*)*[|:]?\s*$/i;
const CHANGE_EVENTS = new Set(["push", "pull_request", "pull_request_target", "merge_group"]);
const DEPLOY = /^(?:terraform (?:plan|apply)|helm (?:upgrade|install)|kubectl (?:apply|rollout))\b/;
const RELEASE = /^(?:make release|docker push|git tag)\b|\bpublish\b/;
const VERSION = /^v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?$/;
/** 2: make targets carry what their recipe runs. 3: image releases and tag settings. */
export const PROFILE_FORMAT = 3;
// GNU make's search order.
const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];
const isMakefile = (file: string) => MAKEFILES.includes(posix.basename(file));
const CONDITIONAL = /^\s*(?:ifeq|ifneq|ifdef|ifndef|else|endif)\b/;
// `name: VAR = x` and `name: export VAR=x` set a variable for the target and add no recipe.
const TARGET_VAR = /^\s*(?:export\s+|override\s+)?[\w.-]+\s*(?:::?=|[?+!]?=)/;
// Fetching dependencies is setup, not what a check runs.
const SETUP = /^(?:go (?:mod|get)|npm ci)\b/;
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

/** `a && b` is two commands; `cd dir && make test` keeps make test. */
function commandsIn(text: string): string[] {
  return text
    .split(/\s*&&\s*/)
    .map((x) => x.trim().replace(/\s+/g, " "))
    .filter(isCommand);
}

/** Paragraphs and list items, joined so a wrapped sentence keeps its negation. */
function blocks(raw: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let cur: string[] = [];
  let start = 0;
  raw.split("\n").forEach((l, i) => {
    const bullet = /^\s*(?:[-*]|\d+\.)\s/.test(l);
    // A table row is a block of its own: a "never" in one row must not negate the next.
    const row = /^\s*\|/.test(l) || /^\s*\|/.test(cur[cur.length - 1] ?? "");
    if (l.trim() === "" || bullet || row || /^#/.test(l)) {
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

/**
 * Each Makefile target's recipe as commands: `@`, `-` and `+` prefixes dropped; setup steps,
 * single words and non-commands skipped, since a task naming one of them would name the target.
 * A later rule for the same target (`::`, prerequisites only) adds to its recipe.
 */
function recipes(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[][] = [];
  const take = (line: string) => {
    for (const x of commandsIn(line.trim().replace(/^[@+-]+\s*/, ""))) {
      if (!x.includes(" ") || SETUP.test(x) || roleOf(x, false) === null) continue;
      for (const r of current) r.push(x);
    }
  };
  for (const l of raw.replace(/\\\n\s*/g, " ").split("\n")) {
    if (l.startsWith("\t")) {
      take(l);
      continue;
    }
    if (CONDITIONAL.test(l)) continue;
    // `name:` or `a b::`, never an assignment (`X := 1`, `X ::= 1`).
    const m = /^([^\s:#=][^:=]*?)\s*::?(?![:=])(.*)$/.exec(l);
    if (m) {
      const rest = m[2] ?? "";
      if (TARGET_VAR.test(rest)) {
        current = [];
        continue;
      }
      current = (m[1] ?? "").split(/\s+/).map((name) => {
        const r = out.get(name) ?? [];
        out.set(name, r);
        return r;
      });
      const inline = rest.indexOf(";");
      if (inline >= 0) take(rest.slice(inline + 1));
    } else if (l.trim() !== "" && !l.trim().startsWith("#")) current = [];
  }
  return out;
}

function docCommands(raw: string, file: string): Command[] {
  const out: Command[] = [];
  for (const b of blocks(raw)) {
    for (const m of b.text.matchAll(/`([^`\n]+)`/g)) {
      const at = m.index ?? 0;
      // The sentence holding the span, up to the span itself.
      const sentenceStart = Math.max(b.text.lastIndexOf(". ", at), b.text.lastIndexOf(".\n", at));
      const before = b.text
        .slice(sentenceStart < 0 ? 0 : sentenceStart + 1, at)
        .replace(/\s+/g, " ");
      const line = b.line + (b.text.slice(0, at).match(/\n/g)?.length ?? 0);
      for (const text of commandsIn(m[1] ?? "")) {
        const role = roleOf(text, GOVERNS.test(before));
        if (role) out.push({ text, role, source: `${file}:${line}` });
      }
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
  for (const l of lines.flatMap((x) => x.replace(/\\\n\s*/g, " ").split("\n"))) {
    for (const text of commandsIn(l)) {
      const role = roleOf(text, false);
      if (role) out.push({ text, role, source: `${file}:${lineOf(raw, text)}` });
    }
  }
  return out;
}

function githubJobs(doc: Record<string, unknown>, raw: string, file: string): Job[] {
  const on = doc.on ?? doc.true;
  // Only change triggers put a job on a part: dispatch, schedule and tag pushes run on no change.
  const filters: Filter[] = [];
  if (typeof on === "string" || Array.isArray(on)) {
    for (const ev of strings(on)) if (CHANGE_EVENTS.has(ev)) filters.push(null);
  } else if (on && typeof on === "object") {
    for (const [name, ev] of Object.entries(on as Record<string, unknown>)) {
      if (!CHANGE_EVENTS.has(name)) continue;
      const e = (ev ?? {}) as Record<string, unknown>;
      const tagsOnly =
        (e.tags || e["tags-ignore"]) && !e.branches && !e.paths && !e["paths-ignore"];
      if (tagsOnly) continue;
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
    // extends: copies the script of the named (often hidden) jobs.
    const base = strings(job.extends).map((x) => (doc[x] ?? {}) as Record<string, unknown>);
    const script =
      "script" in job ? job.script : base.map((b) => b.script).find((x) => x !== undefined);
    if (script === undefined) continue;
    // changes: is a list, or {paths: [...]} in its documented long form.
    const changesOf = (c: unknown) => [
      ...strings(c),
      ...strings((c as Record<string, unknown>)?.paths),
    ];
    const changes = [
      ...(Array.isArray(job.rules) ? job.rules : []).flatMap((r) =>
        changesOf((r as Record<string, unknown>)?.changes),
      ),
      ...changesOf(((job.only ?? {}) as Record<string, unknown>).changes),
    ];
    out.push({
      filters: changes.length > 0 ? [{ paths: changes }] : [null],
      commands: ciCommands(raw, file, strings(script)),
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

/** Every document of a YAML file; a document pm cannot parse is noted once and skipped. */
function yamlDocs(raw: string, file: string, notes: string[]): unknown[] {
  const out: unknown[] = [];
  for (const chunk of raw.split(/^---[ \t]*$/m)) {
    if (!chunk.trim()) {
      out.push(null);
      continue;
    }
    try {
      out.push(Bun.YAML.parse(chunk));
    } catch (e) {
      if (!notes.some((n) => n.startsWith(`${file}:`))) {
        notes.push(`${file}: not valid YAML (${(e as Error).message.split("\n")[0]})`);
      }
      out.push(null);
    }
  }
  return out;
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
  } else if (isMakefile(base)) {
    raw.split("\n").forEach((l, i) => {
      const m = /^([A-Z][A-Z0-9_]*)\s*(?:::?=|[?+]?=)\s*(\S+)\s*$/.exec(l);
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

const LITERAL_FILE =
  /\.tf$|(?:^|\/)(?:GNUmakefile|makefile|Makefile)$|(?:^|\/)values[^/]*\.ya?ml$|(?:^|\/)kustomization\.ya?ml$/;
const isDeployConfig = (file: string) =>
  /^(?:values.*|kustomization)\.ya?ml$/.test(posix.basename(file));

export async function extractProfile(
  checkout: string,
  opts: { url?: string; registry?: string } = {},
): Promise<Profile> {
  const notes: string[] = [];
  const head = await git(["rev-parse", "HEAD"], checkout);
  if (head.code !== 0) {
    return {
      revision: "",
      parts: [],
      links: [],
      notes: ["no commits: nothing to read yet"],
      shared: [],
      releases: [],
      tagSettings: [],
      format: PROFILE_FORMAT,
    };
  }
  const revision = head.stdout.trim();
  const files = (await gitOk(["ls-files"], checkout)).split("\n").filter(Boolean);
  const folders = [
    ...new Set(files.filter((f) => STACKS.some(([re]) => re.test(f))).map(folderOf)),
  ].sort();
  // Longest folder first, so the first match is the nearest enclosing part; computed once per file.
  const byDepth = [...folders].sort((a, b) => b.length - a.length);
  const nearest = new Map(files.map((f) => [f, byDepth.find((x) => inside(f, x)) ?? null]));
  const partOf = (file: string): string | null => nearest.get(file) ?? null;
  const ownFiles = new Map<string, string[]>(folders.map((x) => [x, []]));
  for (const [f, folder] of nearest) if (folder !== null) ownFiles.get(folder)?.push(f);
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
  // Each part gets its own copy: what a command runs is set per command below.
  const add = (part: Part, cs: Command[]) => {
    for (const c of cs) {
      if (!part.commands.some((x) => x.text === c.text && x.role === c.role))
        part.commands.push({ ...c });
    }
  };

  const shared: Command[] = [];
  for (const part of parts) {
    for (const name of ["AGENTS.md", "README.md"]) {
      const f = part.folder ? `${part.folder}/${name}` : name;
      if (files.includes(f)) add(part, docCommands(await read(f), f));
    }
  }
  // A root that is not a part still speaks for the whole repo (infra's AGENTS.md).
  if (!folders.includes("")) {
    for (const name of ["AGENTS.md", "README.md"]) {
      if (!files.includes(name)) continue;
      const cs = docCommands(await read(name), name);
      shared.push(...cs.map((c) => ({ ...c })));
      for (const part of parts) add(part, cs);
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
    const own = ownFiles.get(part.folder) ?? [];
    for (const j of jobs) if (covers(j.filters, own)) add(part, j.commands);
  }
  for (const j of jobs) {
    if (j.filters.includes(null)) {
      for (const c of j.commands) if (!shared.some((x) => x.text === c.text)) shared.push({ ...c });
    }
  }
  // Planners write the recipe (`go test ./...`) as often as the target (`make test`). A doc's
  // `make` runs its folder's Makefile; a CI step runs from the repo root.
  const byFolder = new Map<string, Map<string, string[]> | null>();
  const recipesIn = async (folder: string) => {
    if (!byFolder.has(folder)) {
      const f = MAKEFILES.map((n) => (folder ? `${folder}/${n}` : n)).find((x) =>
        files.includes(x),
      );
      byFolder.set(folder, f ? recipes(await read(f)) : null);
    }
    return byFolder.get(folder) ?? null;
  };
  for (const c of [...parts.flatMap((x) => x.commands), ...shared]) {
    const target = /^make ([\w.-]+)$/.exec(c.text)?.[1];
    if (!target) continue;
    const file = c.source.slice(0, c.source.lastIndexOf(":"));
    const doc = /(?:^|\/)(?:AGENTS|README)\.md$/.test(file);
    const runs = (await recipesIn(doc ? folderOf(file) : ""))?.get(target);
    if (runs && runs.length > 0) c.runs = [...runs];
  }

  const found: (Literal & { folder: string })[] = [];
  for (const f of files.filter((x) => LITERAL_FILE.test(x))) {
    const folder = partOf(f);
    if (folder === null) continue;
    for (const l of literals(await read(f), f, notes)) found.push({ ...l, folder });
  }
  const links: Link[] = [];
  for (const c of found.filter((x) => isDeployConfig(x.file))) {
    for (const s of found) {
      if (s.value !== c.value || s.folder === c.folder || isDeployConfig(s.file)) continue;
      const release =
        VERSION.test(c.value) && isMakefile(s.file) && /(?:^|\.)(?:tag|newTag)$/.test(c.key);
      const end = (x: Literal & { folder: string }): LinkEnd => ({
        folder: x.folder,
        file: x.file,
        line: x.line,
        key: x.key,
      });
      links.push({ value: c.value, source: end(s), consumer: end(c), release });
    }
  }
  const { releases, tagSettings } = await extractImages(
    files,
    read,
    (raw, f) => yamlDocs(raw, f, notes),
    async (f) => recipes(await read(f)),
    { ...opts, partOf: (f) => byDepth.find((x) => inside(f, x)) ?? null },
    notes,
  );
  return { revision, parts, links, notes, shared, releases, tagSettings, format: PROFILE_FORMAT };
}

export function partId(projectId: string, folder: string): string {
  return folder ? `${projectId}/${folder}` : projectId;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Lookarounds, so "helm unittest" can match tool and subcommand across one space.
const word = (s: string) => `(?<![\\w-])${esc(s)}(?![\\w-])`;

/**
 * A task names a command when it holds the command itself, or the tool and its last plain word
 * in order on one line (`make -C svc test` by "make test"); a path tool by its file name.
 * Case matters, so "Make sure" never names make. What a make target runs counts only verbatim.
 */
export function namesCommand(text: string, c: Command): boolean {
  if (namesVerbatim(text, c)) return true;
  const t = flat(c.text).split(" ");
  const first = t[0] ?? "";
  if (first.includes("/")) return new RegExp(word(posix.basename(first))).test(text);
  const sub = t
    .slice(1)
    .filter((x) => /^[a-z][\w-]*$/.test(x))
    .pop();
  if (!sub) return TOOLS.has(first) && new RegExp(word(first)).test(text);
  return new RegExp(`${word(first)}[^\\n]*?${word(sub)}`).test(text);
}

const flat = (x: string) => x.replace(/\s+/g, " ").trim();

/** The command as written, or a command its make target runs as a whole word (`npm test`, not `pnpm test`). */
export function namesVerbatim(text: string, c: Command): boolean {
  const t = flat(text);
  if (t.includes(flat(c.text))) return true;
  return c.runs?.some((r) => new RegExp(word(flat(r))).test(t)) ?? false;
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
  if (p.releases.length > 0) {
    lines.push("", "Image releases:", "");
    for (const r of p.releases.slice(0, 20)) {
      const what = r.image ? `\`${r.image}\`` : `unresolved (${r.unresolved ?? "unknown"})`;
      lines.push(`- ${what} on a ${r.trigger.pattern} ${r.trigger.kind} (${r.source})`);
    }
  }
  if (p.tagSettings.length > 0) {
    lines.push("", "Image tags set here:", "");
    for (const t of p.tagSettings.slice(0, 20)) {
      lines.push(`- \`${t.image}\` \`${t.key}\` in ${t.file}:${t.line} (\`${t.value}\`)`);
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
      ? {
          ...p,
          shared: Array.isArray(p.shared) ? p.shared : [],
          releases: Array.isArray(p.releases) ? p.releases : [],
          tagSettings: Array.isArray(p.tagSettings) ? p.tagSettings : [],
        }
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

/** Research's view of a stored profile: kept out of pruning, so it is short by construction. */
/** Files whose change can change a profile; any other commit leaves it current. */
const PROFILE_INPUT =
  /^\.github\/workflows\/|^\.gitlab-ci\.ya?ml$|(?:^|\/)(?:AGENTS|README)\.md$|(?:^|\/)(?:go\.mod|Chart\.yaml|kustomization\.ya?ml|package\.json|pyproject\.toml|Cargo\.toml|GNUmakefile|makefile|Makefile)$|\.tf$|\.ya?ml$/;

export function profileInputChanged(changed: string[]): boolean {
  return changed.some((f) => PROFILE_INPUT.test(f));
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** A role's commands, a few at most, each clipped: research pays for this on every call. */
function some(cs: Command[], role: Role, n: number): string {
  const xs = cs.filter((c) => c.role === role).map((c) => clip(c.text));
  return xs.length > n ? `${xs.slice(0, n).join("; ")} (+${xs.length - n} more)` : xs.join("; ");
}

/**
 * Research's view of a stored profile, kept out of pruning, so it holds itself to a character
 * budget: a few commands per part, parts with the same checks collapsed, the rest in the file.
 */
/** A release joined to the places in other registered repos that set its image's tag. */
export interface CrossLink {
  project: string;
  release: ImageRelease;
  rollouts: (TagSetting & { project: string; checks: string[] })[];
  /** registered repos whose tag settings pm could not read: no profile, or one before format 3 */
  unread: string[];
}

/**
 * Joins releases to tag settings across projects by image name; same-repo ones are links'.
 * `missing` names the registered projects with no stored profile.
 */
export function crossLinks(profiles: Map<string, Profile>, missing: string[] = []): CrossLink[] {
  const out: CrossLink[] = [];
  for (const [project, p] of profiles) {
    const unread = [
      ...[...profiles]
        .filter(([q, other]) => q !== project && (other.format ?? 1) < 3)
        .map(([q]) => `${q} (profile older than format 3: pm project refresh ${q})`),
      ...missing.filter((q) => q !== project).map((q) => `${q} (no profile)`),
    ];
    for (const release of p.releases ?? []) {
      const rollouts = [...profiles].flatMap(([q, other]) =>
        q === project || !release.image
          ? []
          : (other.tagSettings ?? [])
              .filter((t) => t.image === release.image)
              .map((t) => ({
                ...t,
                project: q,
                checks: (other.parts.find((x) => x.folder === t.folder)?.commands ?? [])
                  .filter((c) => c.role === "check")
                  .map((c) => c.text),
              })),
      );
      out.push({ project, release, rollouts, unread });
    }
  }
  return out;
}

const triggerPhrase = (t: ImageRelease["trigger"]) =>
  t.kind === "tag"
    ? `on a ${t.pattern} tag`
    : t.kind === "branch"
      ? `on a push to ${t.pattern}`
      : `with ${t.pattern}`;
const fileOf = (source: string) => source.replace(/:\d+$/, "");

/**
 * What a project's own cross-repo releases add to its block, in two groups. `plans` (a link and
 * its plan line per release step) lead the block; `rest` (releases nobody deploys, names pm could
 * not resolve) follow everything else, so the budget cuts them first.
 */
function releaseLines(
  projectId: string,
  p: Profile,
  cross: CrossLink[],
): { plans: string[]; rest: string[] } {
  const own = cross.filter((c) => c.project === projectId);
  const plans: string[] = [];
  const rest: string[] = [];
  // One link per release step: a matrix of images in one step shares its trigger and its plan.
  const steps = new Map<string, CrossLink[]>();
  for (const c of own.filter((x) => x.release.image && x.rollouts.length > 0)) {
    const k = JSON.stringify([c.release.source, c.release.trigger, c.release.folder]);
    steps.set(k, [...(steps.get(k) ?? []), c]);
  }
  for (const group of steps.values()) {
    const r = (group[0] as CrossLink).release;
    const images = [...new Set(group.map((c) => c.release.image as string))];
    const rollouts = group
      .flatMap((c) => c.rollouts)
      .filter(
        (t, i, all) =>
          all.findIndex(
            (x) => x.project === t.project && x.file === t.file && x.line === t.line,
          ) === i,
      );
    const places = rollouts.map((t) => `${t.project} ${t.file}:${t.line} ${t.key}`).join(", ");
    const them = images.length === 1 ? "rolls it out" : "roll them out";
    plans.push(
      clip(
        `  release link: ${projectId} ${fileOf(r.source)} pushes ${images.join(", ")} ${triggerPhrase(r.trigger)}; ${places} ${them}`,
        300,
      ),
    );
    const ids = [...new Set(rollouts.map((t) => partId(t.project, t.folder)))];
    const files = [...new Set(rollouts.map((t) => t.file))];
    const checks = [...new Set(rollouts.flatMap((t) => t.checks))].slice(0, 2);
    const key = rollouts[0]?.key ?? "the tag";
    const named =
      checks.length > 0
        ? ` (its checks: ${checks.map((c) => `\`${clip(c, 60)}\``).join(", ")})`
        : "";
    const sets = `that sets ${key} in ${files.join(" or ")}${named}`;
    const target =
      ids.length === 1
        ? `a task with parts: [${ids[0]}] ${sets}`
        : `at least one task with parts: ${ids.map((x) => `[${x}]`).join(" or ")} ${sets}`;
    const source = partId(projectId, r.folder);
    const plan =
      r.trigger.kind === "branch"
        ? `    plan: when tasks have parts: [${source}], the merge is the release; then ${target} to the tag CI pushes on merge (a version or commit SHA), and depends on them`
        : r.trigger.kind === "tag"
          ? `    plan: when tasks have parts: [${source}], add a task that pushes a ${r.trigger.pattern} tag (the release) and depends on them, then ${target} and depends on the release`
          : `    plan: when tasks have parts: [${source}], add a task that runs ${r.trigger.pattern} and depends on them, then ${target} and depends on the release`;
    plans.push(clip(plan, 400));
  }
  // A rollout in this repo is the same-repo link's; only a release nobody deploys is reported.
  const lonely = own.filter(
    (c) =>
      c.release.image &&
      c.rollouts.length === 0 &&
      !(p.tagSettings ?? []).some((t) => t.image === c.release.image),
  );
  if (lonely.length > 0) {
    const r = (lonely[0] as CrossLink).release;
    const images = [...new Set(lonely.map((c) => c.release.image as string))];
    const unread = (lonely[0] as CrossLink).unread;
    const found =
      unread.length > 0
        ? `rollout: not found; not read: ${unread.join(", ")}`
        : "rollout: none found in registered repos";
    rest.push(
      clip(
        `  release: ${projectId} ${fileOf(r.source)} pushes ${images.join(", ")} ${triggerPhrase(r.trigger)}; ${found}`,
        300,
      ),
    );
  }
  const unresolved = own.filter((c) => !c.release.image);
  if (unresolved.length === 1) {
    const r = (unresolved[0] as CrossLink).release;
    rest.push(
      clip(
        `  release: ${projectId} ${fileOf(r.source)}: image name unresolved: ${r.unresolved ?? "unknown"}`,
        300,
      ),
    );
  } else if (unresolved.length > 1) {
    const r = (unresolved[0] as CrossLink).release;
    rest.push(
      clip(
        `  ${unresolved.length} releases with an unresolved image name (first: ${fileOf(r.source)}: ${r.unresolved ?? "unknown"})`,
        300,
      ),
    );
  }
  return { plans, rest };
}

export function formatPartsBlock(
  projectId: string,
  p: Profile,
  stale: string | null,
  budget = 1500,
  cross: CrossLink[] = [],
): string[] {
  const head = [`parts: ${projectId} @ ${p.revision.slice(0, 7)}`];
  if (stale) {
    head.push(
      `stale: the repo's CI, docs or config changed (checkout at ${stale.slice(0, 7)}); tell the user to run pm project refresh ${projectId}`,
    );
  }
  if (!stale && (p.format ?? 1) < PROFILE_FORMAT) {
    head.push(`stale: stored by an older pm; tell the user to run pm project refresh ${projectId}`);
  }
  const body: string[] = [];
  // Cross-repo release plans lead, like same-repo release links: the plan line is what first
  // drafts miss. Rollouts this repo performs and lone or unresolved releases come last.
  const { plans, rest } = releaseLines(projectId, p, cross);
  body.push(...plans);
  const rollsOut: string[] = [];
  for (const c of cross) {
    for (const t of c.rollouts.filter((x) => x.project === projectId)) {
      rollsOut.push(
        clip(
          `  ${partId(projectId, t.folder)}: ${t.file}:${t.line} ${t.key} rolls out ${c.project}'s ${c.release.image} (release ${triggerPhrase(c.release.trigger)})`,
          300,
        ),
      );
    }
  }
  const linkLine = (l: Link) =>
    clip(
      `  ${l.release ? "release link" : "link"}: ${l.consumer.file} ${l.consumer.key} follows ${l.source.file} ${l.source.key}`,
      120,
    );
  // Release links first, so the budget never cuts the plan line: in the paired run every first
  // draft missed it. One plan line per release and key, however many values files carry it.
  const planned = new Set<string>();
  for (const l of p.links.filter((x) => x.release)) {
    body.push(linkLine(l));
    const release = p.parts
      .find((x) => x.folder === l.source.folder)
      ?.commands.find((c) => c.role === "release");
    const source = partId(projectId, l.source.folder);
    const consumer = partId(projectId, l.consumer.folder);
    const key = JSON.stringify([source, consumer, l.consumer.key]);
    if (!release || planned.has(key)) continue;
    planned.add(key);
    body.push(
      clip(
        `    plan: when tasks have parts: [${source}], add a task that runs ${clip(release.text, 60)} and depends on them, then a task with parts: [${consumer}] that sets ${l.consumer.key} and depends on the release`,
        300,
      ),
    );
  }
  if (!p.parts.some((x) => x.folder === "") && p.shared.length > 0) {
    body.push(`  ${projectId} (repo-wide): checks ${some(p.shared, "check", 3) || "none known"}`);
  }
  const seen = new Map<string, string>();
  for (const part of p.parts) {
    const id = partId(projectId, part.folder);
    const key = JSON.stringify(part.commands.map((c) => [c.role, c.text]));
    const same = seen.get(key);
    if (same) {
      body.push(`  ${id}: same checks as ${same}`);
      continue;
    }
    seen.set(key, id);
    const say = [`checks ${some(part.commands, "check", 3) || "none known"}`];
    for (const [role, label] of [
      ["release", "releases with"],
      ["deploy", "deploys with"],
      ["forbidden", "do not run"],
    ] as [Role, string][]) {
      const xs = some(part.commands, role, 2);
      if (xs) say.push(`${label} ${xs}`);
    }
    body.push(`  ${id} (${part.stacks.join(", ")}): ${say.join(" · ")}`);
  }
  for (const l of p.links.filter((x) => !x.release)) body.push(linkLine(l));
  body.push(...[...new Set(rollsOut)], ...rest);
  const out = [...head];
  let used = out.join("\n").length;
  for (const [i, line] of body.entries()) {
    if (used + line.length + 1 > budget) {
      out.push(`  ... ${body.length - i} more lines in docs/pm/projects/${projectId}.md`);
      return out;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out;
}

/** The project and folder a part id names, by the longest project id that prefixes it. */
export function resolvePart(
  id: string,
  profiles: Map<string, Profile>,
): { project: string; part: Part } | null {
  const project = [...profiles.keys()]
    .filter((p) => id === p || id.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (project === undefined) return null;
  const folder = id === project ? "" : id.slice(project.length + 1);
  const profile = profiles.get(project);
  const part = profile?.parts.find((x) => x.folder === folder);
  if (part) return { project, part };
  // The bare repo id of a repo without a root part means the whole repo, as for a new folder.
  if (folder === "" && profile)
    return { project, part: { folder: "", stacks: [], commands: profile.shared } };
  return null;
}
