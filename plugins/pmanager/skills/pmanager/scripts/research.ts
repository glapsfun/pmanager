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
