import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contractVersion, getList, getString, sessionOf, setFrontmatterKey } from "./contract";
import { writeLogEntry } from "./log";
import { type EpicRecord, loadPmRepo, type PmRepo } from "./repo";

export const TASKS_START = "<!-- pm:tasks:start -->";
export const TASKS_END = "<!-- pm:tasks:end -->";
export const LOG_START = "<!-- pm:log:start -->";
export const LOG_END = "<!-- pm:log:end -->";

const DASH = "—";

export function repoShortName(url: string): string {
  let m = /^[\w.-]+@[\w.-]+:(.+?)(?:\.git)?$/.exec(url);
  if (m?.[1]) return m[1];
  m = /^https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (m?.[1]) return m[1];
  return url;
}

export function taskCounts(epic: EpicRecord): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of epic.tasks) {
    const s = getString(t.frontmatter, "status");
    if (s === "descoped") continue;
    total++;
    if (s === "done") done++;
  }
  return { done, total };
}

function cell(v: string | undefined, fallback = DASH): string {
  return v && v.trim() !== "" ? v : fallback;
}

export function renderIndex(repo: PmRepo): string {
  const rows = repo.epics
    .filter((e) => e.epic !== null)
    .map((e) => {
      const fm = e.epic?.frontmatter ?? {};
      const session = sessionOf(fm);
      const repos = getList(fm, "repos").map(repoShortName).join(", ");
      const { done, total } = taskCounts(e);
      const cells = [
        `[${e.slug}](${e.slug}/epic.md)`,
        cell(getString(fm, "title")),
        cell(getString(fm, "type"), "unknown"),
        cell(getString(fm, "status"), "unknown"),
        cell(getString(fm, "owner"), "unassigned"),
        session ? `${session.harness} · ${session.claimed}` : DASH,
        cell(repos),
        `${done}/${total}`,
        cell(getString(fm, "primary-metric"), "unknown"),
        cell(getString(fm, "updated"), "unknown"),
      ];
      return {
        created: getString(fm, "created") ?? "",
        slug: e.slug,
        line: `| ${cells.join(" | ")} |`,
      };
    })
    .sort((a, b) =>
      a.created === b.created ? a.slug.localeCompare(b.slug) : b.created.localeCompare(a.created),
    );
  const header =
    "# PM index\n\n| Epic | Title | Type | Status | Owner | Session | Repos | Tasks | Primary metric | Updated |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n";
  return header + rows.map((r) => `${r.line}\n`).join("");
}

export function renderTaskTable(epic: EpicRecord): string {
  const rows = [...epic.tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => {
      const fm = t.frontmatter;
      const deps = getList(fm, "depends-on").join(", ");
      const cells = [
        t.id,
        cell(getString(fm, "title")),
        cell(getString(fm, "milestone"), "unknown"),
        cell(getString(fm, "priority"), "unknown"),
        cell(deps),
        cell(getString(fm, "status"), "unknown"),
      ];
      return `| ${cells.join(" | ")} |\n`;
    });
  return `${TASKS_START}\n| Task | Title | Milestone | Priority | Depends on | Status |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${rows.join("")}${TASKS_END}\n`;
}

export function renderMemoLog(repo: PmRepo): string {
  const entries = [...repo.logs].sort((a, b) =>
    a.date === b.date ? b.path.localeCompare(a.path) : b.date.localeCompare(a.date),
  );
  const lines =
    entries.length === 0
      ? ["- none yet"]
      : entries.map((e) => `- ${e.date} — \`${e.epic}\` · ${e.kind} · ${e.message}`);
  return `${LOG_START}\n${lines.join("\n")}\n${LOG_END}\n`;
}

export type MarkerState = "ok" | "missing" | "unterminated" | "misordered";

/** Whether `text` holds exactly one well-formed start…end region. */
export function markerState(text: string, start: string, end: string): MarkerState {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1) return "missing";
  if (e === -1) return "unterminated";
  if (e < s) return "misordered";
  const secondStart = text.indexOf(start, s + start.length);
  if (secondStart !== -1 && secondStart < e) return "misordered";
  return "ok";
}

export function replaceBetweenMarkers(
  text: string,
  start: string,
  end: string,
  replacement: string,
): string | null {
  const s = text.indexOf(start);
  if (s === -1) return null;
  const e = text.indexOf(end, s);
  if (e === -1) return null;
  const afterEnd = e + end.length + (text[e + end.length] === "\n" ? 1 : 0);
  return text.slice(0, s) + replacement + text.slice(afterEnd);
}

export interface RenderFile {
  path: string;
  before: string | null;
  after: string;
}

export function planRender(repo: PmRepo): RenderFile[] {
  const out: RenderFile[] = [];
  const index = renderIndex(repo);
  if (repo.index !== index) {
    out.push({ path: join(repo.pmDir, "INDEX.md"), before: repo.index, after: index });
  }
  for (const epic of repo.epics) {
    if (!epic.plan) continue;
    const next = replaceBetweenMarkers(
      epic.plan.raw,
      TASKS_START,
      TASKS_END,
      renderTaskTable(epic),
    );
    if (next !== null && next !== epic.plan.raw) {
      out.push({ path: epic.plan.path, before: epic.plan.raw, after: next });
    }
  }
  if (repo.memo) {
    const next = replaceBetweenMarkers(repo.memo.raw, LOG_START, LOG_END, renderMemoLog(repo));
    if (next !== null && next !== repo.memo.raw) {
      out.push({ path: repo.memo.path, before: repo.memo.raw, after: next });
    }
  }
  return out;
}

export async function applyRender(repo: PmRepo): Promise<string[]> {
  const files = planRender(repo);
  for (const f of files) await writeFile(f.path, f.after);
  return files.map((f) => f.path);
}

function wrapPlanTable(raw: string): string | null {
  if (raw.includes(TASKS_START)) return null;
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Task |"));
  if (start === -1) return null;
  let end = start;
  while (end < lines.length && (lines[end] ?? "").startsWith("|")) end++;
  lines.splice(end, 0, TASKS_END);
  lines.splice(start, 0, TASKS_START);
  return lines.join("\n");
}

const MEMO_LINE_RE = /^- (\d{4}-\d{2}-\d{2}) — (.*)$/;
const CHANGELOG_HEADING_RE = /^## .*changelog/i;

/**
 * Line-based memo migration: only the changelog section is rewritten; every
 * line before its heading and every section after it is preserved verbatim.
 * Without a changelog heading a fresh section is appended.
 */
async function migrateMemo(raw: string, pmDir: string): Promise<string> {
  const lines = raw.split("\n");
  const heading = lines.findIndex((l) => CHANGELOG_HEADING_RE.test(l));
  if (heading === -1) {
    const base = raw.replace(/\n+$/, "");
    return `${base}\n\n## 5. Changelog\n\n${LOG_START}\n${LOG_END}\n`;
  }
  let end = heading + 1;
  while (end < lines.length && !(lines[end] ?? "").startsWith("## ")) end++;
  const kept: string[] = [];
  for (const l of lines.slice(heading + 1, end)) {
    const m = MEMO_LINE_RE.exec(l);
    if (m?.[1] && m[2] !== undefined) {
      await writeLogEntry(pmDir, {
        date: m[1],
        epic: "-",
        harness: "migrated",
        kind: "update",
        message: m[2],
      });
    } else {
      kept.push(l);
    }
  }
  while (kept.length > 0 && (kept[kept.length - 1] ?? "").trim() === "") kept.pop();
  const section = [...kept, "", LOG_START, LOG_END, ""];
  return [...lines.slice(0, heading + 1), ...section, ...lines.slice(end)].join("\n");
}

export async function migrate(repo: PmRepo, _today: string): Promise<string[]> {
  const touched: string[] = [];
  for (const epic of repo.epics) {
    if (epic.epic && contractVersion(epic.epic.frontmatter) === 0) {
      let raw = epic.epic.raw;
      raw = setFrontmatterKey(raw, "contract", "1");
      if (epic.epic.frontmatter.repos === undefined) raw = setFrontmatterKey(raw, "repos", []);
      if (getString(epic.epic.frontmatter, "primary-metric") === undefined) {
        raw = setFrontmatterKey(raw, "primary-metric", "unknown");
      }
      await writeFile(epic.epic.path, raw);
      touched.push(epic.epic.path);
    }
    for (const t of epic.tasks) {
      if (contractVersion(t.frontmatter) === 0) {
        await writeFile(t.path, setFrontmatterKey(t.raw, "contract", "1"));
        touched.push(t.path);
      }
    }
    if (epic.plan) {
      const wrapped = wrapPlanTable(epic.plan.raw);
      if (wrapped !== null) {
        await writeFile(epic.plan.path, setFrontmatterKey(wrapped, "contract", "1"));
        touched.push(epic.plan.path);
      } else if (contractVersion(epic.plan.frontmatter) === 0) {
        await writeFile(epic.plan.path, setFrontmatterKey(epic.plan.raw, "contract", "1"));
        touched.push(epic.plan.path);
      }
    }
  }
  if (repo.memo && !repo.memo.raw.includes(LOG_START)) {
    await writeFile(repo.memo.path, await migrateMemo(repo.memo.raw, repo.pmDir));
    touched.push(repo.memo.path);
  }
  if (touched.length > 0) await applyRender(await loadPmRepo(repo.root));
  return touched;
}
