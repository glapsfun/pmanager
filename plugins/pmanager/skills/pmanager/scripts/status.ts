import { isStale } from "./check";
import { getList, getString, type Session, sessionOf } from "./contract";
import { taskCounts } from "./render";
import type { EpicRecord, PmRepo, TaskDoc } from "./repo";

export type RemoteClaims = Map<string, Session | null>;
export type RemoteState = "ok" | "none" | "unreachable";

export interface NextTask {
  id: string;
  title: string;
  priority: string;
}

export interface EpicStatusRow {
  slug: string;
  title: string;
  status: string;
  owner: string;
  session: Session | null;
  remoteClaim: boolean;
  stale: boolean;
  done: number;
  total: number;
  blocked: string[];
  next: NextTask | null;
}

export interface StatusReport {
  remote: RemoteState;
  rows: EpicStatusRow[];
}

const RANK: Record<string, number> = { must: 0, should: 1, could: 2 };

export function nextTask(epic: EpicRecord): TaskDoc | null {
  const status = new Map(epic.tasks.map((t) => [t.id, getString(t.frontmatter, "status") ?? ""]));
  const ready = epic.tasks.filter(
    (t) =>
      status.get(t.id) === "todo" &&
      getList(t.frontmatter, "depends-on").every((d) => status.get(d) === "done"),
  );
  ready.sort((a, b) => {
    const ra = RANK[getString(a.frontmatter, "priority") ?? ""] ?? 9;
    const rb = RANK[getString(b.frontmatter, "priority") ?? ""] ?? 9;
    return ra === rb ? a.id.localeCompare(b.id) : ra - rb;
  });
  return ready[0] ?? null;
}

export function buildStatus(
  repo: PmRepo,
  remoteClaims: RemoteClaims | null,
  remote: RemoteState,
  opts: { staleDays: number; today: string },
): StatusReport {
  const rows: EpicStatusRow[] = [];
  for (const e of repo.epics) {
    if (!e.epic) continue;
    const fm = e.epic.frontmatter;
    const remoteClaim = remoteClaims?.has(e.slug) ?? false;
    const session = remoteClaim ? (remoteClaims?.get(e.slug) ?? null) : sessionOf(fm);
    const { done, total } = taskCounts(e);
    const next = nextTask(e);
    rows.push({
      slug: e.slug,
      title: getString(fm, "title") ?? e.slug,
      status: getString(fm, "status") ?? "unknown",
      owner: getString(fm, "owner") ?? "unassigned",
      session,
      remoteClaim,
      stale:
        session !== null && isStale(getString(fm, "updated") ?? "", opts.today, opts.staleDays),
      done,
      total,
      blocked: e.tasks
        .filter((t) => getString(t.frontmatter, "status") === "blocked")
        .map((t) => t.id),
      next: next
        ? {
            id: next.id,
            title: getString(next.frontmatter, "title") ?? next.id,
            priority: getString(next.frontmatter, "priority") ?? "",
          }
        : null,
    });
  }
  return { remote, rows };
}

export function formatStatus(report: StatusReport): string {
  const lines = [`remote: ${report.remote}`];
  if (report.rows.length === 0) lines.push("no epics under docs/pm");
  for (const r of report.rows) {
    const flags = `${r.remoteClaim ? " [remote]" : ""}${r.stale ? " [stale]" : ""}`;
    const session = r.session ? `${r.session.harness} · ${r.session.claimed}${flags}` : "unowned";
    lines.push(
      `${r.slug}  ${r.status}  owner: ${r.owner}  session: ${session}  tasks: ${r.done}/${r.total}`,
    );
    if (r.blocked.length > 0) lines.push(`  blocked: ${r.blocked.join(", ")}`);
    lines.push(
      r.next ? `  next: ${r.next.id} ${r.next.title} (${r.next.priority})` : "  next: none ready",
    );
  }
  return `${lines.join("\n")}\n`;
}
