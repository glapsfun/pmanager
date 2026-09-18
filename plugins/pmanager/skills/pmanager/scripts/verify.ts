import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { getList, sectionBody } from "./contract";
import { gitTimed, repoRoot } from "./git";
import type { EpicRecord } from "./repo";
import { failure } from "./research";

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
