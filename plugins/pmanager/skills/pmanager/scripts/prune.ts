import { type PruneCounts, type ResearchReport, researchHeader } from "./research";

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

const FILL_ORDER = ["memory", "files", "history", "tests", "docs", "gh"] as const;
type SectionName = (typeof FILL_ORDER)[number];
const GROUPED = new Set<SectionName>(["files", "docs"]);
const FILTERED = new Set<SectionName>(["files", "docs", "tests"]);
const FLOOR = 3;
/** the pruned: line plus one header per section */
const HEADER_RESERVE = 20 + FILL_ORDER.length * 8;

interface Group {
  path: string;
  lines: string[];
}

interface Section {
  name: SectionName;
  groups: Group[];
  chosen: Set<number>[];
  next: number;
  open: boolean;
}

function groupLines(lines: string[], grouped: boolean): Group[] {
  const out: Group[] = [];
  for (const line of lines) {
    const path = sourcePath(line);
    const last = out[out.length - 1];
    if (grouped && last?.path === path) last.lines.push(line);
    else out.push({ path, lines: [line] });
  }
  return out;
}

function collapseImports(g: Group): string {
  const kws = [...new Set(g.lines.flatMap(lineKeywords))];
  return `[${g.path}] imports${kws.length > 0 ? ` ${kws.join(", ")}` : ""}`;
}

function dropNoise(groups: Group[], counts: PruneCounts): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    if (isDataPath(g.path)) {
      counts.data += g.lines.length;
      continue;
    }
    const kept = g.lines.filter((l) => !isImportLine(lineBody(l)));
    counts.import += g.lines.length - kept.length;
    // a file that only imports the keyword stays visible as one line
    out.push({ path: g.path, lines: kept.length > 0 ? kept : [collapseImports(g)] });
  }
  return out;
}

function lead(g: Group): number {
  const i = g.lines.findIndex((l) => isDefinitionLine(lineBody(l)));
  return i < 0 ? 0 : i;
}

function fill(sections: Section[], budget: number, reserved: number): void {
  let spent = reserved;
  const take = (s: Section, gi: number, li: number, force: boolean): boolean => {
    const line = s.groups[gi]?.lines[li];
    if (line === undefined) return false;
    const cost = estimateTokens(`  ${line}\n`);
    if (!force && spent + cost > budget) return false;
    spent += cost;
    s.chosen[gi]?.add(li);
    return true;
  };
  for (const s of sections) {
    s.next = Math.min(FLOOR, s.groups.length);
    for (let gi = 0; gi < s.next; gi++) take(s, gi, lead(s.groups[gi] as Group), true);
  }
  let open = sections.filter((s) => s.next < s.groups.length);
  while (open.length > 0) {
    for (const s of open) {
      if (take(s, s.next, lead(s.groups[s.next] as Group), false)) s.next++;
      else s.open = false;
    }
    open = open.filter((s) => s.open && s.next < s.groups.length);
  }
  const deepen = (s: Section): void => {
    for (;;) {
      let added = false;
      for (let gi = 0; gi < s.groups.length; gi++) {
        const chosen = s.chosen[gi] as Set<number>;
        if (chosen.size === 0) continue;
        const li = (s.groups[gi] as Group).lines.findIndex((_, i) => !chosen.has(i));
        if (li < 0) continue;
        if (!take(s, gi, li, false)) return;
        added = true;
      }
      if (!added) return;
    }
  };
  for (const s of sections) if (GROUPED.has(s.name)) deepen(s);
}

/** Drops noise, then fits the report to about `budgetTokens`; the probes themselves are unchanged. */
export function prune(r: ResearchReport, budgetTokens = DEFAULT_BUDGET): ResearchReport {
  const counts: PruneCounts = { import: 0, data: 0, budget: 0, budgetTokens };
  const sections: Section[] = [];
  for (const name of FILL_ORDER) {
    const p = r.probes[name];
    if (p.error || p.lines.length === 0) continue;
    const grouped = groupLines(p.lines, GROUPED.has(name));
    const groups = FILTERED.has(name) ? dropNoise(grouped, counts) : grouped;
    sections.push({ name, groups, chosen: groups.map(() => new Set()), next: 0, open: true });
  }
  const units = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.lines.length, 0), 0);
  fill(sections, budgetTokens, estimateTokens(`${researchHeader(r)}\n`) + HEADER_RESERVE);
  const probes = { ...r.probes };
  let printed = 0;
  for (const s of sections) {
    const lines = s.groups.flatMap((g, gi) => g.lines.filter((_, li) => s.chosen[gi]?.has(li)));
    printed += lines.length;
    const shown = GROUPED.has(s.name) ? s.chosen.filter((c) => c.size > 0).length : lines.length;
    probes[s.name] = { ...r.probes[s.name], lines, shown };
  }
  counts.budget = units - printed;
  return { ...r, probes, pruned: counts };
}
