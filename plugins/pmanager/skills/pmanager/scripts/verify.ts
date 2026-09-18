import { basename } from "node:path";
import { sectionBody } from "./contract";

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
