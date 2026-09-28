export const DEFAULT_BUDGET = 1500;
export const MIN_BUDGET = 300;

const DATA_FILE =
  /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|gemfile\.lock|composer\.lock)$|\.(jsonl|ndjson|csv|tsv|map|snap)$|\.min\.[^/]+$/i;
const DATA_DIR = /(^|\/)(dist|build|vendor|node_modules)\//;
const IMPORT =
  /^(import[\s{]|export\s+\*\s+from\s|export\s+(type\s+)?\{[^}]*\}\s+from\s|from\s+\S+\s+import\s|#include\s|using\s+[\w.]+\s*;|use\s+\S.*;$|(const|let|var)\s+[^=]+=\s*require\(|require\()/;
const DEFINITION =
  /^(export\s+)?(default\s+)?(async\s+)?(function\b|class\b|def\b|interface\b|type\b|enum\b|struct\b|fn\b|func\b|pub\s+fn\b)|^(export\s+)?const\s+\w+\s*=/;
const SOURCE = /^\[([^\]]+?)(?::\d+)?\]\s?(.*)$/;
const KW_TAG = /\s+# kw: (.+)$/;

/** Rough token count: a quarter of the characters. Good enough to size output, never billed. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function isDataPath(path: string): boolean {
  return DATA_FILE.test(path) || DATA_DIR.test(path);
}

export function isImportLine(body: string): boolean {
  return IMPORT.test(body);
}

export function isDefinitionLine(body: string): boolean {
  return DEFINITION.test(body);
}

export function sourcePath(line: string): string {
  return SOURCE.exec(line)?.[1] ?? "";
}

export function lineBody(line: string): string {
  return (SOURCE.exec(line)?.[2] ?? line).replace(KW_TAG, "").trim();
}

export function lineKeywords(line: string): string[] {
  return (KW_TAG.exec(line)?.[1] ?? "").split(", ").filter((k) => k.length > 0);
}
