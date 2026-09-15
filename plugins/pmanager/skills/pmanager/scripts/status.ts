import { isStale } from "./check";
import type { RemoteEpic } from "./claim";
import { getList, getString, type Session, sessionOf } from "./contract";
import { taskCounts } from "./render";
import type { EpicRecord, PmRepo, TaskDoc } from "./repo";

/** slug -> epic as read from origin/pm/<slug>; null when the branch exists but the epic is unreadable. */
export type RemoteClaims = Map<string, RemoteEpic | null>;
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
  /** true when the epic exists only on a remote claim branch, not in this checkout */
  remoteOnly: boolean;
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
    const remote = remoteClaims?.get(e.slug);
    const remoteClaim = remoteClaims?.has(e.slug) ?? false;
    const session = remoteClaim ? (remote?.session ?? null) : sessionOf(fm);
    // The claim record lives on the remote branch, so its staleness does too.
    const updated = remoteClaim ? (remote?.updated ?? "") : (getString(fm, "updated") ?? "");
    const { done, total } = taskCounts(e);
    const next = nextTask(e);
    rows.push({
      slug: e.slug,
      title: getString(fm, "title") ?? e.slug,
      status: getString(fm, "status") ?? "unknown",
      owner: getString(fm, "owner") ?? "unassigned",
      session,
      remoteClaim,
      remoteOnly: false,
      stale: session !== null && isStale(updated, opts.today, opts.staleDays),
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
  const local = new Set(repo.epics.map((e) => e.slug));
  for (const [slug, remote] of remoteClaims ?? []) {
    if (local.has(slug)) continue;
    const session = remote?.session ?? null;
    rows.push({
      slug,
      title: remote?.title ?? slug,
      status: remote?.status ?? "unknown",
      owner: remote?.owner ?? "unassigned",
      session,
      remoteClaim: true,
      remoteOnly: true,
      stale: session !== null && isStale(remote?.updated ?? "", opts.today, opts.staleDays),
      done: 0,
      total: 0,
      blocked: [],
      next: null,
    });
  }
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  return { remote, rows };
}

export function formatStatus(report: StatusReport): string {
  const lines = [`remote: ${report.remote}`];
  if (report.rows.length === 0) lines.push("no epics under docs/pm");
  for (const r of report.rows) {
    const flags = `${r.remoteOnly ? " [remote-only]" : r.remoteClaim ? " [remote]" : ""}${r.stale ? " [stale]" : ""}`;
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
