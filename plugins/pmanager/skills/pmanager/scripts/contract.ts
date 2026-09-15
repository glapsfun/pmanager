export const CONTRACT_VERSION = 1;

export const EPIC_STATUSES = ["draft", "approved", "in-progress", "done", "abandoned"] as const;
export const PLAN_STATUSES = EPIC_STATUSES;
export const TASK_STATUSES = ["todo", "in-progress", "blocked", "done", "descoped"] as const;
export const EPIC_TYPES = ["bug", "feature", "tech-debt", "initiative"] as const;
export const PRIORITIES = ["must", "should", "could"] as const;
export const ESTIMATES = ["S", "M", "L"] as const;

export const EPIC_REQUIRED_FIELDS = [
  "id",
  "title",
  "type",
  "status",
  "owner",
  "created",
  "updated",
];
export const EPIC_V1_FIELDS = ["contract", "repos", "primary-metric"];
export const TASK_REQUIRED_FIELDS = [
  "id",
  "epic",
  "milestone",
  "title",
  "status",
  "priority",
  "depends-on",
  "estimate",
  "updated",
];
export const TASK_V1_FIELDS = ["contract"];
export const PLAN_REQUIRED_FIELDS = ["epic", "status", "updated"];

export const EPIC_REQUIRED_SECTIONS = [
  "Problem statement",
  "Evidence",
  "Hypothesis",
  "Success metrics",
  "Non-goals",
];
export const TASK_REQUIRED_SECTIONS = [
  "Context",
  "What to do",
  "Acceptance criteria",
  "Out of scope",
];
export const PLAN_REQUIRED_SECTIONS = [
  "Approach",
  "Milestones",
  "Task breakdown & traceability",
  "Prioritization",
  "Risk register",
  "Changelog",
];

export type FmValue = string | string[] | Record<string, string>;
export type Frontmatter = Record<string, FmValue>;

export interface ParsedDoc {
  path: string;
  frontmatter: Frontmatter;
  body: string;
  raw: string;
}

export interface Session {
  harness: string;
  claimed: string;
  branch: string;
}

const FENCE = "---\n";

export function splitFrontmatter(raw: string): { yaml: string; body: string } | null {
  if (!raw.startsWith(FENCE)) return null;
  const end = raw.indexOf("\n---\n", FENCE.length - 1);
  if (end === -1) return null;
  return { yaml: raw.slice(FENCE.length, end + 1), body: raw.slice(end + 5) };
}

function stripComment(s: string): string {
  const i = s.indexOf(" #");
  return (i === -1 ? s : s.slice(0, i)).trim();
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1);
  }
  return s;
}

function parseScalarOrInlineList(rest: string): string | string[] {
  if (rest.startsWith("[") && rest.endsWith("]")) {
    const inner = rest.slice(1, -1).trim();
    if (inner === "") return [];
    return inner
      .split(",")
      .map((x) => unquote(x.trim()))
      .filter((x) => x !== "");
  }
  return unquote(rest);
}

const KEY_RE = /^([A-Za-z][\w-]*):(.*)$/;

export function parseYamlSubset(yaml: string): Frontmatter {
  const fm: Frontmatter = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    i++;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = KEY_RE.exec(line);
    if (!m) throw new Error(`unparseable frontmatter line: ${JSON.stringify(line)}`);
    const key = m[1] ?? "";
    const rest = stripComment(m[2] ?? "");
    if (rest !== "") {
      fm[key] = parseScalarOrInlineList(rest);
      continue;
    }
    const block: string[] = [];
    while (
      i < lines.length &&
      ((lines[i] ?? "").startsWith("  ") || (lines[i] ?? "").trim() === "")
    ) {
      const l = lines[i] ?? "";
      i++;
      if (l.trim() === "") continue;
      block.push(l.slice(2));
    }
    if (block.length === 0) {
      fm[key] = "";
    } else if (block.every((l) => l.startsWith("- "))) {
      fm[key] = block.map((l) => unquote(stripComment(l.slice(2))));
    } else {
      const map: Record<string, string> = {};
      for (const l of block) {
        const mm = KEY_RE.exec(l);
        if (!mm) throw new Error(`unparseable nested line under ${key}: ${JSON.stringify(l)}`);
        map[mm[1] ?? ""] = unquote(stripComment(mm[2] ?? ""));
      }
      fm[key] = map;
    }
  }
  return fm;
}

export function parseDoc(path: string, raw: string): ParsedDoc {
  const parts = splitFrontmatter(raw);
  if (!parts) return { path, frontmatter: {}, body: raw, raw };
  try {
    return { path, frontmatter: parseYamlSubset(parts.yaml), body: parts.body, raw };
  } catch {
    return { path, frontmatter: {}, body: parts.body, raw };
  }
}

function needsQuotes(s: string): boolean {
  return (
    s === "" || s.includes(": ") || s.startsWith("[") || s.startsWith("#") || s.startsWith("- ")
  );
}

function scalar(s: string): string {
  return needsQuotes(s) ? JSON.stringify(s) : s;
}

export function formatFmValue(key: string, value: FmValue): string {
  if (typeof value === "string") return `${key}: ${scalar(value)}\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []\n`;
    return `${key}:\n${value.map((v) => `  - ${scalar(v)}\n`).join("")}`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return `${key}:\n`;
  return `${key}:\n${entries.map(([k, v]) => `  ${k}: ${scalar(v)}\n`).join("")}`;
}

export function setFrontmatterKey(raw: string, key: string, value: FmValue | undefined): string {
  const parts = splitFrontmatter(raw);
  if (!parts) {
    if (value === undefined) return raw;
    return `${FENCE}${formatFmValue(key, value)}---\n${raw}`;
  }
  const lines = parts.yaml.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const out: string[] = [];
  let i = 0;
  let replaced = false;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = KEY_RE.exec(line);
    if (m && m[1] === key) {
      i++;
      while (i < lines.length && (lines[i] ?? "").startsWith("  ")) i++;
      if (value !== undefined && !replaced) {
        out.push(formatFmValue(key, value).replace(/\n$/, ""));
        replaced = true;
      }
      continue;
    }
    out.push(line);
    i++;
  }
  if (!replaced && value !== undefined) out.push(formatFmValue(key, value).replace(/\n$/, ""));
  return `${FENCE}${out.join("\n")}\n---\n${parts.body}`;
}

export function getString(fm: Frontmatter, key: string): string | undefined {
  const v = fm[key];
  return typeof v === "string" ? v : undefined;
}

export function getList(fm: Frontmatter, key: string): string[] {
  const v = fm[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v !== "") return [v];
  return [];
}

export function getMap(fm: Frontmatter, key: string): Record<string, string> | undefined {
  const v = fm[key];
  return v !== undefined && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

export function contractVersion(fm: Frontmatter): number {
  const v = getString(fm, "contract");
  if (v === undefined) return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function sessionOf(fm: Frontmatter): Session | null {
  const m = getMap(fm, "session");
  if (!m) return null;
  return { harness: m.harness ?? "", claimed: m.claimed ?? "", branch: m.branch ?? "" };
}

function normalizeHeading(h: string): string {
  return h
    .replace(/\s*\(required\)\s*$/, "")
    .trim()
    .toLowerCase();
}

export function sectionBody(body: string, heading: string): string | null {
  const want = normalizeHeading(heading);
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (l.startsWith("## ") && normalizeHeading(l.slice(3)) === want) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if ((lines[i] ?? "").startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function hasSection(body: string, heading: string): boolean {
  return sectionBody(body, heading) !== null;
}
