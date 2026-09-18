import { basename } from "node:path";

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
