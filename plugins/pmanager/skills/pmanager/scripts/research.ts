import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitTimed } from "./git";
import type { RunResult } from "./proc";

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
