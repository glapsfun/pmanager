import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { getList, getString, sectionBody } from "./contract";
import { gitTimed, repoRoot } from "./git";
import type { EpicRecord, TaskDoc } from "./repo";
import { classifyPath, failure } from "./research";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const SPEC_PREFIX = "docs/pm/";

const FILE_EXTS = new Set([
  "py",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "java",
  "kt",
  "rb",
  "php",
  "cs",
  "swift",
  "sql",
  "md",
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "env",
  "sh",
  "bash",
  "css",
  "scss",
  "html",
  "csv",
  "proto",
  "tf",
  "lock",
  "xml",
  "gradle",
]);
const PATH_TOKEN =
  /[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]*)+|[A-Za-z0-9_-]{2,}\.[A-Za-z][A-Za-z0-9]{0,4}\b/g;

export function extractPathTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_TOKEN)) {
    const raw = m[0].replace(/[.,:;)]+$/, "");
    const before = text.slice(Math.max(0, (m.index ?? 0) - 3), m.index ?? 0);
    // "://host/a/b" would otherwise yield "host/a/b"; a plain "/app/x.py" keeps its token
    if (before.endsWith("//") || raw.startsWith(".") || raw.startsWith(SPEC_PREFIX)) continue;
    if (/^\d+(\.\d+)*$/.test(raw)) continue;
    if (!raw.includes("/")) {
      const ext = raw.slice(raw.lastIndexOf(".") + 1).toLowerCase();
      if (!FILE_EXTS.has(ext)) continue;
    }
    out.add(raw);
  }
  return [...out];
}

export function pathMatches(token: string, path: string): boolean {
  const t = token.replace(/\/$/, "");
  if (t.includes("/") || token.endsWith("/")) {
    return (
      path === t || path.startsWith(`${t}/`) || path.endsWith(`/${t}`) || path.includes(`/${t}/`)
    );
  }
  return basename(path) === t;
}

export function matchPaths(token: string, listed: string[]): string[] {
  return listed.filter((p) => !p.startsWith(SPEC_PREFIX) && pathMatches(token, p));
}

const MEASURE =
  /\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|mins|minutes|h|hours|%|x|kb|mb|gb|rps|qps)\b|[<>]=?\s*\d|\b(?:under|below|over|above|at least|at most|within|less than|more than|max|min)\s+\d/i;
const SNAKE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;

export interface CriterionTokens {
  paths: string[];
  idents: string[];
  measured: boolean;
}

export interface Criterion {
  text: string;
  checked: boolean;
  tokens: CriterionTokens;
}

export interface EvidenceLine {
  source: string;
  fact: string;
  repo: string;
  paths: string[];
}

export function tokeniseCriterion(text: string): CriterionTokens {
  const paths = extractPathTokens(text);
  const idents = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const v = (m[1] ?? "").trim();
    if (v && !paths.includes(v)) idents.add(v);
  }
  for (const m of text.matchAll(SNAKE)) idents.add(m[0]);
  return { paths, idents: [...idents], measured: MEASURE.test(text) };
}

export function parseCriteria(body: string): Criterion[] {
  const section = sectionBody(body, "Acceptance criteria") ?? "";
  const out: Criterion[] = [];
  for (const line of section.split("\n")) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = (m[2] ?? "").trim();
    out.push({ text, checked: m[1] !== " ", tokens: tokeniseCriterion(text) });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Identifiers match on non-alphanumeric boundaries so idx_order_items_x still hits order_items. */
function identHits(ident: string, line: EvidenceLine): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(ident)}(?![A-Za-z0-9])`, "i");
  return (
    re.test(line.fact) || line.paths.some((p) => p.toLowerCase().includes(ident.toLowerCase()))
  );
}

export function attachEvidence(
  criteria: CriterionTokens[],
  lines: EvidenceLine[],
): { attached: EvidenceLine[][]; unattributed: EvidenceLine[] } {
  const attached = criteria.map(() => [] as EvidenceLine[]);
  const unattributed: EvidenceLine[] = [];
  for (const line of lines) {
    let hit = false;
    criteria.forEach((c, i) => {
      const byPath = c.paths.some((t) => line.paths.some((p) => pathMatches(t, p)));
      if (byPath || c.idents.some((id) => identHits(id, line))) {
        attached[i]?.push(line);
        hit = true;
      }
    });
    if (!hit) unattributed.push(line);
  }
  return { attached, unattributed };
}

export function labelCriterion(
  c: { checked: boolean; tokens: CriterionTokens },
  attached: number,
): string {
  let base: string;
  if (c.tokens.measured && c.tokens.paths.length === 0) base = "needs measurement";
  else if (attached > 0) base = `evidence: ${attached} line${attached === 1 ? "" : "s"}`;
  else base = "no evidence in scope";
  return c.checked ? `already checked · ${base}` : base;
}

export function formatEvidence(e: EvidenceLine, withRepo: boolean): string {
  return withRepo ? `[${e.repo}:${e.source}] ${e.fact}` : `[${e.source}] ${e.fact}`;
}

export type SinceReason = "--since" | "task updated" | "epic created" | "repo start";

export interface SinceRule {
  ref?: string;
  date?: string;
  reason: SinceReason;
}

export interface Since {
  date: string | null;
  sha: string | null;
  reason: SinceReason;
}

export function resolveSince(i: {
  sinceRef?: string;
  taskStatus?: string;
  taskUpdated?: string;
  epicCreated?: string;
}): SinceRule {
  if (i.sinceRef) return { ref: i.sinceRef, reason: "--since" };
  if ((i.taskStatus === "in-progress" || i.taskStatus === "blocked") && i.taskUpdated) {
    return { date: i.taskUpdated, reason: "task updated" };
  }
  if (i.epicCreated) return { date: i.epicCreated, reason: "epic created" };
  return { reason: "repo start" };
}

export async function sinceSha(
  cwd: string,
  rule: SinceRule,
  timeoutMs: number,
): Promise<{ since: Since; error?: string }> {
  if (rule.ref) {
    const r = await gitTimed(
      ["rev-parse", "--short", "--verify", `${rule.ref}^{commit}`],
      cwd,
      timeoutMs,
    );
    const error = failure(r, timeoutMs);
    if (error) {
      return {
        since: { date: null, sha: null, reason: rule.reason },
        error: `--since ${rule.ref}: ${error}`,
      };
    }
    return { since: { date: null, sha: r.stdout.trim(), reason: rule.reason } };
  }
  if (!rule.date) return { since: { date: null, sha: null, reason: rule.reason } };
  const r = await gitTimed(
    ["rev-list", "-1", "--abbrev-commit", `--before=${rule.date}`, "HEAD"],
    cwd,
    timeoutMs,
  );
  const error = failure(r, timeoutMs);
  if (error) {
    return { since: { date: rule.date, sha: null, reason: rule.reason }, error: `since: ${error}` };
  }
  return { since: { date: rule.date, sha: r.stdout.trim() || null, reason: rule.reason } };
}

export interface RepoTarget {
  name: string;
  path: string;
}

export function repoName(url: string): string {
  return basename(url.replace(/\/+$/, "")).replace(/\.git$/, "");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveTarget(
  root: string,
  repoArg: string | undefined,
  map: Record<string, string>,
): Promise<{ target: RepoTarget } | { error: string }> {
  if (repoArg === undefined) return { target: { name: ".", path: root } };
  const mapped = map[repoArg];
  const candidate = mapped ?? ((await isDirectory(repoArg)) ? repoArg : null);
  if (candidate === null) {
    const known = Object.keys(map).sort().join(", ") || "none";
    return { error: `unknown repo ${repoArg}; known names in docs/pm/.local/repos.json: ${known}` };
  }
  const path = await repoRoot(candidate);
  if (!path) return { error: `${candidate} is not inside a git repository` };
  return { target: { name: repoName(repoArg), path } };
}

export async function resolveRepos(
  root: string,
  epic: EpicRecord,
  repoArg: string | undefined,
  map: Record<string, string>,
): Promise<{ targets: RepoTarget[]; gaps: string[] } | { error: string }> {
  if (repoArg !== undefined) {
    const r = await resolveTarget(root, repoArg, map);
    return "error" in r ? r : { targets: [r.target], gaps: [] };
  }
  const targets: RepoTarget[] = [];
  const gaps: string[] = [];
  for (const url of getList(epic.epic?.frontmatter ?? {}, "repos")) {
    const mapped = map[url];
    if (mapped === undefined) {
      gaps.push(`${url} not checked out on this machine; map it in docs/pm/.local/repos.json`);
      continue;
    }
    const path = await repoRoot(mapped);
    if (!path) gaps.push(`${url} maps to ${mapped}, which is not a git repository`);
    else targets.push({ name: repoName(url), path });
  }
  if (targets.length === 0) {
    if (gaps.length > 0) gaps.push("no mapped repos; inspected the orchestration repo");
    targets.push({ name: ".", path: root });
  }
  return { targets, gaps };
}

export interface VerifyProbeOptions {
  cwd: string;
  repo: string;
  since: Since;
  taskId: string;
  slug: string;
  tokens: string[];
  extraFiles: string[];
  limit: number;
  timeoutMs: number;
}

export interface Probe {
  lines: EvidenceLine[];
  files: string[];
  error?: string;
}

const HEADER_MARK = "\u0001";
export const TAGGED_FORMAT = "--format=%x01%h%x09%as%x09%s";

function notSpec(p: string): boolean {
  return p.length > 0 && !p.startsWith(SPEC_PREFIX);
}

function sinceLabel(s: Since): string {
  return s.date ?? s.sha ?? "root";
}

export async function listFiles(
  cwd: string,
  timeoutMs: number,
): Promise<{ tracked: string[]; untracked: string[]; error?: string }> {
  const [t, u] = await Promise.all([
    gitTimed(["ls-files", "--cached"], cwd, timeoutMs),
    gitTimed(["ls-files", "--others", "--exclude-standard"], cwd, timeoutMs),
  ]);
  const error = failure(t, timeoutMs) ?? failure(u, timeoutMs);
  if (error) return { tracked: [], untracked: [], error };
  return {
    tracked: t.stdout.split("\n").filter(notSpec),
    untracked: u.stdout.split("\n").filter(notSpec),
  };
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export async function probeNamedPaths(o: VerifyProbeOptions, listed: string[]): Promise<Probe> {
  const missing: EvidenceLine[] = [];
  const files = new Set<string>();
  for (const token of [...o.tokens, ...o.extraFiles]) {
    const matched = matchPaths(token, listed).slice(0, o.limit);
    // "and/or" is a token too; only report absence for things that look like files or dirs
    const looksLikeFile = /\.[A-Za-z0-9]+$|\/$/.test(token) || o.extraFiles.includes(token);
    if (matched.length === 0 && looksLikeFile) {
      missing.push({ source: token, fact: "missing", repo: o.repo, paths: [token] });
    }
    for (const p of matched) files.add(p);
  }
  const present = await Promise.all(
    [...files].map(async (p): Promise<EvidenceLine> => {
      const [log, text] = await Promise.all([
        gitTimed(["log", "-1", "--format=%h %as", "--", p], o.cwd, o.timeoutMs),
        readFile(join(o.cwd, p), "utf8").catch(() => null),
      ]);
      const size = text === null ? "unreadable" : `${lineCount(text)} lines`;
      const last = log.stdout.trim() ? `last changed ${log.stdout.trim()}` : "untracked";
      return { source: p, fact: `present, ${size}, ${last}`, repo: o.repo, paths: [p] };
    }),
  );
  return { lines: [...present, ...missing], files: [...files] };
}

export interface TaggedCommit {
  sha: string;
  date: string;
  subject: string;
  files: string[];
}

export function parseNameOnlyLog(stdout: string): TaggedCommit[] {
  const out: TaggedCommit[] = [];
  let cur: TaggedCommit | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith(HEADER_MARK)) {
      const [sha, date, ...rest] = line.slice(1).split("\t");
      cur = { sha: sha ?? "", date: date ?? "", subject: rest.join("\t"), files: [] };
      out.push(cur);
    } else if (line.trim() && cur) cur.files.push(line.trim());
  }
  return out;
}

export async function probeTaggedCommits(
  o: VerifyProbeOptions,
): Promise<Probe & { commits: number }> {
  const range = o.since.sha ? [`${o.since.sha}..HEAD`] : [];
  const r = await gitTimed(
    ["log", "-i", `--grep=${o.taskId}`, `--grep=${o.slug}`, "--name-only", TAGGED_FORMAT, ...range],
    o.cwd,
    o.timeoutMs,
  );
  const error = failure(r, o.timeoutMs);
  if (error) return { lines: [], files: [], commits: 0, error };
  const commits = parseNameOnlyLog(r.stdout)
    .map((c) => ({ ...c, files: c.files.filter(notSpec) }))
    .filter((c) => c.files.length > 0);
  const files = [...new Set(commits.flatMap((c) => c.files))];
  const lines = commits.slice(0, o.limit).map((c): EvidenceLine => {
    const more = c.files.length > 5 ? ` +${c.files.length - 5} more` : "";
    return {
      source: "git log",
      fact: `${c.sha} ${c.date} ${c.subject} · ${c.files.slice(0, 5).join(", ")}${more}`,
      repo: o.repo,
      paths: c.files,
    };
  });
  return { lines, files, commits: commits.length };
}

function worktreeState(xy: string): string {
  if (xy === "??") return "untracked";
  if (xy.includes("D")) return "deleted, uncommitted";
  if (xy.includes("A")) return "added, uncommitted";
  if (xy.includes("R")) return "renamed, uncommitted";
  return "modified, uncommitted";
}

export async function probeWindowedChanges(
  o: VerifyProbeOptions,
): Promise<Probe & { uncommitted: number }> {
  const dirTokens = o.tokens.filter((t) => t.includes("/")).map((t) => t.replace(/\/$/, ""));
  const prefixes = [...new Set([...dirTokens, ...o.extraFiles])];
  if (prefixes.length === 0) return { lines: [], files: [], uncommitted: 0 };
  const base = o.since.sha ?? EMPTY_TREE;
  const [diff, status] = await Promise.all([
    gitTimed(["diff", "--numstat", base, "--", ...prefixes], o.cwd, o.timeoutMs),
    gitTimed(
      ["status", "--porcelain", "--untracked-files=all", "--", ...prefixes],
      o.cwd,
      o.timeoutMs,
    ),
  ]);
  const error = failure(diff, o.timeoutMs) ?? failure(status, o.timeoutMs);
  if (error) return { lines: [], files: [], uncommitted: 0, error };
  const lines: EvidenceLine[] = [];
  const files = new Set<string>();
  for (const l of diff.stdout.split("\n")) {
    const [add, del, path] = l.split("\t");
    if (!path || !notSpec(path)) continue;
    files.add(path);
    lines.push({
      source: "git diff",
      fact: `${path} +${add} -${del} since ${sinceLabel(o.since)}`,
      repo: o.repo,
      paths: [path],
    });
  }
  let uncommitted = 0;
  for (const l of status.stdout.split("\n")) {
    if (l.length < 4) continue;
    const path = l.slice(3).split(" -> ").pop() ?? "";
    if (!notSpec(path)) continue;
    uncommitted++;
    files.add(path);
    lines.push({
      source: "worktree",
      fact: `${path} ${worktreeState(l.slice(0, 2))}`,
      repo: o.repo,
      paths: [path],
    });
  }
  return { lines, files: [...files], uncommitted };
}

function addedLines(diff: string, limit: number): string[] {
  const out: string[] = [];
  for (const l of diff.split("\n")) {
    if (out.length >= limit) break;
    if (l.startsWith("@@")) out.push(l.replace(/ @@.*$/, " @@"));
    else if (l.startsWith("+") && !l.startsWith("+++") && l.trim().length > 1) out.push(l);
  }
  return out;
}

export async function probeHunks(
  o: VerifyProbeOptions,
  files: string[],
  untracked: Set<string>,
): Promise<Probe> {
  const base = o.since.sha ?? EMPTY_TREE;
  const shown = files.slice(0, o.limit);
  const per = await Promise.all(
    shown.map(async (p): Promise<{ lines: string[]; error?: string }> => {
      if (untracked.has(p)) {
        const text = await readFile(join(o.cwd, p), "utf8").catch(() => "");
        const kept = text.split("\n").filter((l) => l.trim().length > 0);
        return { lines: kept.slice(0, o.limit).map((l) => `+${l}`) };
      }
      const r = await gitTimed(["diff", base, "--", p], o.cwd, o.timeoutMs);
      const error = failure(r, o.timeoutMs);
      return error ? { lines: [], error } : { lines: addedLines(r.stdout, o.limit) };
    }),
  );
  const lines: EvidenceLine[] = [];
  per.forEach((h, i) => {
    const p = shown[i] ?? "";
    for (const l of h.lines) lines.push({ source: p, fact: l, repo: o.repo, paths: [p] });
  });
  return { lines, files, error: per.find((h) => h.error)?.error };
}

export async function probeTests(o: VerifyProbeOptions, files: string[]): Promise<Probe> {
  const touched = files.filter((f) => classifyPath(f) === "test");
  const lines: EvidenceLine[] = touched.map((t) => ({
    source: t,
    fact: "touched in scope",
    repo: o.repo,
    paths: [t],
  }));
  const stems = [
    ...new Set(
      files
        .filter((f) => classifyPath(f) !== "test")
        .map((f) => basename(f).replace(/\.[^.]+$/, "")),
    ),
  ].filter((s) => s.length >= 3);
  if (stems.length > 0) {
    const r = await gitTimed(
      ["grep", "-l", "-i", "-w", "-F", ...stems.flatMap((s) => ["-e", s])],
      o.cwd,
      o.timeoutMs,
    );
    const error = failure(r, o.timeoutMs, [0, 1]);
    if (error) return { lines, files: touched, error };
    for (const p of r.stdout.split("\n")) {
      if (!p || classifyPath(p) !== "test" || touched.includes(p)) continue;
      const lower = (await readFile(join(o.cwd, p), "utf8").catch(() => "")).toLowerCase();
      const refs = stems.filter((s) =>
        new RegExp(`\\b${escapeRe(s.toLowerCase())}\\b`).test(lower),
      );
      if (refs.length > 0) {
        lines.push({ source: p, fact: `references ${refs.join(", ")}`, repo: o.repo, paths: [p] });
      }
    }
  }
  return { lines: lines.slice(0, o.limit), files: touched };
}

export interface VerifyOptions {
  epic: EpicRecord;
  task: TaskDoc;
  targets: RepoTarget[];
  gaps: string[];
  sinceRef?: string;
  files: string[];
  limit: number;
  timeoutMs?: number;
}

export interface CriterionReport {
  text: string;
  checked: boolean;
  label: string;
  evidence: EvidenceLine[];
}

export interface VerifyReport {
  slug: string;
  task: string;
  repos: { name: string; path: string; since: Since }[];
  criteria: CriterionReport[];
  unattributed: EvidenceLine[];
  scope: { files: number; commits: number; uncommitted: number; testsTouched: number };
  gaps: string[];
  errors: string[];
  durationMs: number;
}

interface RepoRun {
  since: Since;
  lines: EvidenceLine[];
  scope: VerifyReport["scope"];
  errors: string[];
}

type SharedProbeOptions = Omit<VerifyProbeOptions, "cwd" | "repo" | "since">;

async function verifyRepo(
  target: RepoTarget,
  rule: SinceRule,
  o: SharedProbeOptions,
): Promise<RepoRun> {
  const errors: string[] = [];
  const prefix = target.name === "." ? "" : `${target.name}: `;
  const tag = (probe: string, e?: string) => {
    if (e) errors.push(`${prefix}${probe}: ${e}`);
  };
  const bound = await sinceSha(target.path, rule, o.timeoutMs);
  tag("since", bound.error);
  const po: VerifyProbeOptions = { ...o, cwd: target.path, repo: target.name, since: bound.since };
  const listed = await listFiles(po.cwd, po.timeoutMs);
  tag("ls-files", listed.error);
  const [named, tagged, windowed] = await Promise.all([
    probeNamedPaths(po, [...listed.tracked, ...listed.untracked]),
    probeTaggedCommits(po),
    probeWindowedChanges(po),
  ]);
  tag("tagged commits", tagged.error);
  tag("windowed changes", windowed.error);
  const files = [...new Set([...named.files, ...tagged.files, ...windowed.files])].filter(notSpec);
  const [hunks, tests] = await Promise.all([
    probeHunks(po, files, new Set(listed.untracked)),
    probeTests(po, files),
  ]);
  tag("hunks", hunks.error);
  tag("tests", tests.error);
  return {
    since: bound.since,
    lines: [...named.lines, ...tagged.lines, ...windowed.lines, ...hunks.lines, ...tests.lines],
    scope: {
      files: files.length,
      commits: tagged.commits,
      uncommitted: windowed.uncommitted,
      testsTouched: tests.lines.length,
    },
    errors,
  };
}

/** Repos run one after another, probes inside each concurrently; nothing here throws. */
export async function buildVerify(opts: VerifyOptions): Promise<VerifyReport> {
  const started = performance.now();
  const tfm = opts.task.frontmatter;
  const rule = resolveSince({
    sinceRef: opts.sinceRef,
    taskStatus: getString(tfm, "status"),
    taskUpdated: getString(tfm, "updated"),
    epicCreated: getString(opts.epic.epic?.frontmatter ?? {}, "created"),
  });
  const criteria = parseCriteria(opts.task.body);
  const shared: SharedProbeOptions = {
    taskId: opts.task.id,
    slug: opts.epic.slug,
    tokens: extractPathTokens(opts.task.body),
    extraFiles: opts.files,
    limit: opts.limit,
    timeoutMs: opts.timeoutMs ?? 30_000,
  };
  const repos: VerifyReport["repos"] = [];
  const lines: EvidenceLine[] = [];
  const scope = { files: 0, commits: 0, uncommitted: 0, testsTouched: 0 };
  const errors: string[] = [];
  for (const target of opts.targets) {
    const run = await verifyRepo(target, rule, shared);
    repos.push({ name: target.name, path: target.path, since: run.since });
    lines.push(...run.lines);
    scope.files += run.scope.files;
    scope.commits += run.scope.commits;
    scope.uncommitted += run.scope.uncommitted;
    scope.testsTouched += run.scope.testsTouched;
    errors.push(...run.errors);
  }
  const { attached, unattributed } = attachEvidence(
    criteria.map((c) => c.tokens),
    lines,
  );
  return {
    slug: opts.epic.slug,
    task: opts.task.id,
    repos,
    criteria: criteria.map((c, i) => ({
      text: c.text,
      checked: c.checked,
      label: labelCriterion(c, attached[i]?.length ?? 0),
      evidence: attached[i] ?? [],
    })),
    unattributed,
    scope,
    gaps: opts.gaps,
    errors,
    durationMs: Math.round(performance.now() - started),
  };
}

function sinceText(s: Since): string {
  if (s.reason === "repo start") return "since repo start";
  if (s.date) return `since ${s.date} (${s.sha ?? "root"}, ${s.reason})`;
  return `since ${s.sha ?? "root"} (${s.reason})`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatVerify(r: VerifyReport): string {
  const multi = r.repos.length > 1;
  const out: string[] = [];
  const names = r.repos.map((x) => x.name).join(", ");
  if (multi) {
    out.push(`verify: ${r.slug} ${r.task} · repos: ${names} · ${r.durationMs}ms`);
    for (const x of r.repos) out.push(`  ${x.name}: ${sinceText(x.since)}`);
  } else {
    const since = r.repos[0] ? ` · ${sinceText(r.repos[0].since)}` : "";
    out.push(`verify: ${r.slug} ${r.task} · repos: ${names}${since} · ${r.durationMs}ms`);
  }
  out.push("");
  if (r.criteria.length === 0) out.push("criteria: none");
  for (const c of r.criteria) {
    out.push(`${`- [${c.checked ? "x" : " "}] ${c.text}`.padEnd(62)} ${c.label}`);
    for (const e of c.evidence) out.push(`    ${formatEvidence(e, multi)}`);
  }
  out.push("");
  if (r.unattributed.length === 0) out.push("unattributed: none");
  else {
    out.push(`unattributed (${r.unattributed.length}):`);
    for (const e of r.unattributed) out.push(`    ${formatEvidence(e, multi)}`);
  }
  const s = r.scope;
  out.push(
    `scope: ${plural(s.files, "file")}, ${plural(s.commits, "commit")}, ${plural(s.uncommitted, "uncommitted change")}, tests touched: ${s.testsTouched}`,
  );
  for (const g of r.gaps) out.push(`gaps: ${g}`);
  for (const e of r.errors) out.push(`errors: ${e}`);
  return `${out.join("\n")}\n`;
}
