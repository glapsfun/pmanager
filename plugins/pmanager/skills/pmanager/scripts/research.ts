import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { gitTimed } from "./git";
import { type RunResult, runTimed } from "./proc";

export type PathKind = "memory" | "doc" | "test" | "code";

export interface FileHit {
  path: string;
  keywords: string[];
  hits: number;
}

const MEMORY_PREFIXES = ["docs/pm/", "docs/sre-incidents/"];
const TEST_DIR = /(^|\/)(tests?|__tests__|specs?)\//i;
const TEST_FILE = /(^|\/)test_[^/]+$|_test\.[^/.]+$|\.(test|spec)\.[^/.]+$/i;
const DOC_DIR = /(^|\/)(docs?|adrs?|runbooks?)\//i;
const DOC_FILE = /(^|\/)readme[^/]*$|\.(md|mdx|rst|adoc|txt)$/i;

export function classifyPath(path: string): PathKind {
  if (MEMORY_PREFIXES.some((p) => path.startsWith(p))) return "memory";
  if (TEST_DIR.test(path) || TEST_FILE.test(path)) return "test";
  if (DOC_DIR.test(path) || DOC_FILE.test(path)) return "doc";
  return "code";
}

export function normalizeKeywords(raw: string[]): string[] {
  return [...new Set(raw.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0))];
}

/** One `git grep -c` output per keyword (same order) plus tracked paths → distinct-keyword hits. */
export function collectHits(
  keywords: string[],
  countOutputs: string[],
  trackedPaths: string[],
): FileHit[] {
  const byPath = new Map<string, { kws: Set<string>; hits: number }>();
  const bump = (path: string, kw: string, n: number) => {
    const cur = byPath.get(path) ?? { kws: new Set<string>(), hits: 0 };
    cur.kws.add(kw);
    cur.hits += n;
    byPath.set(path, cur);
  };
  keywords.forEach((kw, i) => {
    for (const line of (countOutputs[i] ?? "").split("\n")) {
      const sep = line.lastIndexOf(":");
      if (sep <= 0) continue;
      const n = Number.parseInt(line.slice(sep + 1), 10);
      if (Number.isFinite(n) && n > 0) bump(line.slice(0, sep), kw, n);
    }
    for (const path of trackedPaths) {
      if (path.toLowerCase().includes(kw)) bump(path, kw, 1);
    }
  });
  return [...byPath].map(([path, v]) => ({ path, keywords: [...v.kws].sort(), hits: v.hits }));
}

export function rankFiles(hits: Iterable<FileHit>): FileHit[] {
  return [...hits].sort(
    (a, b) =>
      b.keywords.length - a.keywords.length || b.hits - a.hits || a.path.localeCompare(b.path),
  );
}

export interface ProbeOptions {
  cwd: string;
  keywords: string[];
  paths: string[];
  limit: number;
  timeoutMs: number;
}

export interface ProbeResult {
  lines: string[];
  shown: number;
  total: number;
  error?: string;
}

export interface Commit {
  sha: string;
  date: string;
  subject: string;
}

export const LOG_FORMAT = "--format=%h%x09%as%x09%s";

export function failure(r: RunResult, timeoutMs: number, okCodes = [0]): string | undefined {
  if (r.timedOut) return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  if (okCodes.includes(r.code)) return undefined;
  return r.stderr.trim().split("\n")[0] || `exit ${r.code}`;
}

export function capped(lines: string[], limit: number): ProbeResult {
  return {
    lines: lines.slice(0, limit),
    shown: Math.min(lines.length, limit),
    total: lines.length,
  };
}

export function parseLog(stdout: string): Commit[] {
  const out: Commit[] = [];
  for (const line of stdout.split("\n")) {
    const [sha, date, ...rest] = line.split("\t");
    if (!sha || !date) continue;
    out.push({ sha, date, subject: rest.join("\t") });
  }
  return out;
}

/** git grep exits 1 on "no matches"; only other codes are failures. */
const GREP_OK = [0, 1];

export async function collectFileHits(
  o: ProbeOptions,
): Promise<{ hits: FileHit[]; error?: string }> {
  const [tracked, ...counts] = await Promise.all([
    gitTimed(["ls-files", "--", ...o.paths], o.cwd, o.timeoutMs),
    ...o.keywords.map((kw) =>
      gitTimed(["grep", "-c", "-I", "-i", "-e", kw, "--", ...o.paths], o.cwd, o.timeoutMs),
    ),
  ]);
  const error =
    failure(tracked, o.timeoutMs) ??
    counts.map((r) => failure(r, o.timeoutMs, GREP_OK)).find((e) => e !== undefined);
  if (error) return { hits: [], error };
  const paths = tracked.stdout.split("\n").filter((p) => p.length > 0);
  return {
    hits: collectHits(
      o.keywords,
      counts.map((r) => r.stdout),
      paths,
    ),
  };
}

export async function probeHistoryGrep(
  o: ProbeOptions,
): Promise<{ commits: Commit[]; error?: string }> {
  const runs = await Promise.all(
    o.keywords.map((kw) =>
      gitTimed(
        ["log", "-i", `--grep=${kw}`, "-n", String(o.limit), LOG_FORMAT, "--", ...o.paths],
        o.cwd,
        o.timeoutMs,
      ),
    ),
  );
  const error = runs.map((r) => failure(r, o.timeoutMs)).find((e) => e !== undefined);
  if (error) return { commits: [], error };
  return { commits: runs.flatMap((r) => parseLog(r.stdout)) };
}

const MEMORY_INDEXES = ["docs/sre-incidents/INDEX.md", "docs/pm/INDEX.md"];

export async function probeMemory(
  root: string,
  keywords: string[],
  limit: number,
): Promise<ProbeResult> {
  const lines: string[] = [];
  for (const rel of MEMORY_INDEXES) {
    let text: string;
    try {
      text = await readFile(join(root, rel), "utf8");
    } catch {
      continue;
    }
    let inTable = false;
    for (const row of text.split("\n")) {
      if (!row.startsWith("|")) {
        inTable = false;
        continue;
      }
      if (!inTable) {
        inTable = true;
        continue;
      }
      if (/^\|\s*:?-/.test(row)) continue;
      const lower = row.toLowerCase();
      if (!keywords.some((kw) => lower.includes(kw))) continue;
      const cells = row
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      lines.push(`[${rel}] ${cells.join(" | ")}`);
    }
  }
  return capped(lines, limit);
}

const LINE_MAX = 120;
const LINES_PER_FILE = 3;

function kwTag(keywords: string[], text: string): string {
  const lower = text.toLowerCase();
  const matched = keywords.filter((kw) => lower.includes(kw));
  return matched.length > 0 ? `  # kw: ${matched.join(", ")}` : "";
}

export async function grepLines(
  o: ProbeOptions,
  files: string[],
): Promise<{ byPath: Map<string, string[]>; error?: string }> {
  const byPath = new Map<string, string[]>();
  if (files.length === 0) return { byPath };
  const r = await gitTimed(
    ["grep", "-n", "-I", "-i", ...o.keywords.flatMap((kw) => ["-e", kw]), "--", ...files],
    o.cwd,
    o.timeoutMs,
  );
  const error = failure(r, o.timeoutMs, GREP_OK);
  if (error) return { byPath, error };
  for (const line of r.stdout.split("\n")) {
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const [, path, no, text] = m;
    if (!path || !no || text === undefined) continue;
    const list = byPath.get(path) ?? [];
    if (list.length >= LINES_PER_FILE) continue;
    const body = text.trim();
    list.push(`[${path}:${no}] ${body.slice(0, LINE_MAX)}${kwTag(o.keywords, body)}`);
    byPath.set(path, list);
  }
  return { byPath };
}

export async function probeHistoryFiles(
  o: ProbeOptions,
  files: string[],
): Promise<{ commits: Commit[]; error?: string }> {
  if (files.length === 0) return { commits: [] };
  const r = await gitTimed(
    ["log", "-n", String(o.limit), LOG_FORMAT, "--", ...files],
    o.cwd,
    o.timeoutMs,
  );
  const error = failure(r, o.timeoutMs);
  return error ? { commits: [], error } : { commits: parseLog(r.stdout) };
}

export function mergeCommits(groups: Commit[][], limit: number): ProbeResult {
  const seen = new Map<string, Commit>();
  for (const c of groups.flat()) if (!seen.has(c.sha)) seen.set(c.sha, c);
  const sorted = [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
  return capped(
    sorted.map((c) => `[git log] ${c.sha} ${c.date} ${c.subject}`),
    limit,
  );
}

export async function probeTests(
  o: ProbeOptions,
  testHits: FileHit[],
  topCode: string[],
): Promise<ProbeResult> {
  const notes = new Map<string, string[]>();
  for (const h of testHits) notes.set(h.path, [`kw: ${h.keywords.join(", ")}`]);
  const stems = [...new Set(topCode.map((p) => basename(p).replace(/\.[^.]+$/, "")))].filter(
    (s) => s.length >= 3,
  );
  if (stems.length > 0) {
    const r = await gitTimed(
      ["grep", "-l", "-i", "-w", "-F", ...stems.flatMap((s) => ["-e", s]), "--", ...o.paths],
      o.cwd,
      o.timeoutMs,
    );
    const error = failure(r, o.timeoutMs, GREP_OK);
    if (error) return { lines: [], shown: 0, total: 0, error };
    for (const path of r.stdout.split("\n")) {
      if (!path || classifyPath(path) !== "test") continue;
      const lower = (await readFile(join(o.cwd, path), "utf8").catch(() => "")).toLowerCase();
      const refs = stems.filter((s) => new RegExp(`\\b${s.toLowerCase()}\\b`).test(lower));
      if (refs.length === 0) continue;
      notes.set(path, [...(notes.get(path) ?? []), `references ${refs.join(", ")}`]);
    }
  }
  const hasKw = (p: string) => (notes.get(p)?.[0]?.startsWith("kw:") ? 0 : 1);
  const lines = [...notes]
    .sort(([a], [b]) => hasKw(a) - hasKw(b) || a.localeCompare(b))
    .map(([p, n]) => `[${p}] ${n.join("; ")}`);
  return capped(lines, o.limit);
}

function fileSection(top: FileHit[], total: number, byPath: Map<string, string[]>): ProbeResult {
  const lines = top.flatMap(
    (h) => byPath.get(h.path) ?? [`[${h.path}] path matches kw: ${h.keywords.join(", ")}`],
  );
  return { lines, shown: top.length, total };
}

function errored(error: string): ProbeResult {
  return { lines: [], shown: 0, total: 0, error };
}

async function headRef(cwd: string, timeoutMs: number): Promise<string> {
  const r = await gitTimed(["rev-parse", "--short", "HEAD"], cwd, timeoutMs);
  return r.code === 0 ? r.stdout.trim() : "no-commits";
}

interface GhPr {
  number: number;
  title: string;
  mergedAt: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  updatedAt: string;
}

function ghReason(r: RunResult, timeoutMs: number): string | undefined {
  if (r.timedOut) return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  if (r.code === 0) return undefined;
  if (/ENOENT/.test(r.stderr)) return "not installed";
  return r.stderr.trim().split("\n")[0] || `exit ${r.code}`;
}

function parseJsonArray<T>(text: string): T[] | null {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

export async function probeGh(o: ProbeOptions, ghCmd: string): Promise<ProbeResult> {
  const query = o.keywords.join(" ");
  const [prs, issues] = await Promise.all([
    runTimed(
      [
        ghCmd,
        "pr",
        "list",
        "--state",
        "merged",
        "--search",
        query,
        "--limit",
        "10",
        "--json",
        "number,title,mergedAt,url",
      ],
      o.cwd,
      o.timeoutMs,
    ),
    runTimed(
      [
        ghCmd,
        "issue",
        "list",
        "--state",
        "all",
        "--search",
        query,
        "--limit",
        "10",
        "--json",
        "number,title,state,updatedAt,url",
      ],
      o.cwd,
      o.timeoutMs,
    ),
  ]);
  const reason = ghReason(prs, o.timeoutMs) ?? ghReason(issues, o.timeoutMs);
  if (reason) return errored(`unavailable (${reason})`);
  const prList = parseJsonArray<GhPr>(prs.stdout);
  const issueList = parseJsonArray<GhIssue>(issues.stdout);
  if (!prList || !issueList) return errored("unavailable (unreadable gh output)");
  const lines = [
    ...prList.map((p) => `[gh pr #${p.number}] merged ${p.mergedAt.slice(0, 10)} · ${p.title}`),
    ...issueList.map(
      (i) =>
        `[gh issue #${i.number}] ${i.state.toLowerCase()} ${i.updatedAt.slice(0, 10)} · ${i.title}`,
    ),
  ];
  return capped(lines, o.limit);
}

export interface ResearchOptions {
  root: string;
  cwd: string;
  keywords: string[];
  paths: string[];
  limit: number;
  gh: boolean;
  ghCmd?: string;
  timeoutMs?: number;
  ghTimeoutMs?: number;
}

export interface ResearchReport {
  repo: string;
  ref: string;
  keywords: string[];
  paths: string[];
  durationMs: number;
  probes: {
    files: ProbeResult;
    history: ProbeResult;
    docs: ProbeResult;
    memory: ProbeResult;
    tests: ProbeResult;
    gh: ProbeResult;
  };
}

/** Two concurrent stages; every probe reports its own failure, so nothing here throws. */
export async function buildResearch(opts: ResearchOptions): Promise<ResearchReport> {
  const started = performance.now();
  const keywords = normalizeKeywords(opts.keywords);
  const o: ProbeOptions = {
    cwd: opts.cwd,
    keywords,
    paths: opts.paths,
    limit: opts.limit,
    timeoutMs: opts.timeoutMs ?? 30_000,
  };
  const [ref, hits, grepHistory, memory, gh] = await Promise.all([
    headRef(o.cwd, o.timeoutMs),
    collectFileHits(o),
    probeHistoryGrep(o),
    probeMemory(opts.root, keywords, o.limit),
    opts.gh
      ? probeGh({ ...o, timeoutMs: opts.ghTimeoutMs ?? 10_000 }, opts.ghCmd ?? "gh")
      : Promise.resolve(errored("skipped (--no-gh)")),
  ]);
  const ranked = rankFiles(hits.hits);
  const code = ranked.filter((h) => classifyPath(h.path) === "code");
  const docs = ranked.filter((h) => classifyPath(h.path) === "doc");
  const testHits = ranked.filter((h) => classifyPath(h.path) === "test");
  const topCode = code.slice(0, o.limit);
  const topDocs = docs.slice(0, o.limit);
  const topCodePaths = topCode.map((h) => h.path);
  const [lines, fileHistory, tests] = await Promise.all([
    grepLines(o, [...topCodePaths, ...topDocs.map((h) => h.path)]),
    probeHistoryFiles(o, topCodePaths),
    probeTests(o, testHits, topCodePaths),
  ]);
  const hitError = hits.error ?? lines.error;
  const historyError = grepHistory.error ?? fileHistory.error;
  return {
    repo: opts.cwd,
    ref,
    keywords,
    paths: opts.paths,
    durationMs: Math.round(performance.now() - started),
    probes: {
      files: hitError ? errored(hitError) : fileSection(topCode, code.length, lines.byPath),
      history: historyError
        ? errored(historyError)
        : mergeCommits([grepHistory.commits, fileHistory.commits], o.limit),
      docs: hitError ? errored(hitError) : fileSection(topDocs, docs.length, lines.byPath),
      memory,
      tests: hits.error ? errored(hits.error) : tests,
      gh,
    },
  };
}

export function formatResearch(r: ResearchReport): string {
  const paths = r.paths.length > 0 ? r.paths.join(", ") : "(all)";
  const out = [
    `research: ${r.repo} @ ${r.ref} · keywords: ${r.keywords.join(", ")} · paths: ${paths} · ${r.durationMs}ms`,
  ];
  for (const [name, p] of Object.entries(r.probes)) {
    if (p.error) out.push(`${name}: ${p.error}`);
    else if (p.total === 0) out.push(`${name}: none`);
    else {
      out.push(p.total > p.shown ? `${name} (${p.shown} of ${p.total}):` : `${name} (${p.shown}):`);
      for (const line of p.lines) out.push(`  ${line}`);
    }
  }
  return `${out.join("\n")}\n`;
}
