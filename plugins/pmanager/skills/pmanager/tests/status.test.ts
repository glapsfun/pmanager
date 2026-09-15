import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPmRepo } from "../scripts/repo";
import { buildStatus, formatStatus, nextTask } from "../scripts/status";
import { copyFixture, makeTempDir } from "./helpers";

const OPTS = { staleDays: 14, today: "2026-09-15" };

async function fixture() {
  const root = await makeTempDir("status");
  await copyFixture(root);
  return root;
}

async function setStatus(root: string, file: string, to: string) {
  const p = join(root, "docs/pm/app-performance/tasks", file);
  await Bun.write(p, (await readFile(p, "utf8")).replace("status: todo", `status: ${to}`));
}

async function firstEpic(root: string) {
  const repo = await loadPmRepo(root);
  const epic = repo.epics[0];
  if (!epic) throw new Error("fixture epic missing");
  return epic;
}

describe("nextTask", () => {
  test("picks the unblocked must task with the lowest id", async () => {
    expect(nextTask(await firstEpic(await fixture()))?.id).toBe("T01");
  });
  test("after T01 done, T02 (must) beats T04 (should)", async () => {
    const root = await fixture();
    await setStatus(root, "T01-benchmark-orders.md", "done");
    expect(nextTask(await firstEpic(root))?.id).toBe("T02");
  });
  test("T02 blocked → T03 not proposable, T04 suggested", async () => {
    const root = await fixture();
    await setStatus(root, "T01-benchmark-orders.md", "done");
    await setStatus(root, "T02-add-order-items-index.md", "blocked");
    expect(nextTask(await firstEpic(root))?.id).toBe("T04");
  });
  test("null when nothing is ready", async () => {
    const root = await fixture();
    await setStatus(root, "T01-benchmark-orders.md", "blocked");
    await setStatus(root, "T04-restore-pagination.md", "descoped");
    expect(nextTask(await firstEpic(root))).toBeNull();
  });
});

describe("buildStatus", () => {
  test("uses local session when no remote info", async () => {
    const repo = await loadPmRepo(await fixture());
    const report = buildStatus(repo, null, "none", OPTS);
    expect(report.remote).toBe("none");
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row?.session?.harness).toBe("claude-code");
    expect(row?.remoteClaim).toBe(false);
    expect(row?.stale).toBe(false);
    expect(row?.done).toBe(0);
    expect(row?.total).toBe(4);
    expect(row?.next?.id).toBe("T01");
  });
  test("remote claim overrides local frontmatter and marks stale", async () => {
    const repo = await loadPmRepo(await fixture());
    const remote = new Map([
      [
        "app-performance",
        {
          session: { harness: "pi", claimed: "2026-08-01", branch: "pm/app-performance" },
          updated: "2026-08-01",
          title: "Fix orders page latency",
          status: "in-progress",
          owner: "unassigned",
        },
      ],
    ]);
    const report = buildStatus(repo, remote, "ok", { staleDays: 3, today: "2026-09-30" });
    const row = report.rows[0];
    expect(row?.session?.harness).toBe("pi");
    expect(row?.remoteClaim).toBe(true);
    expect(row?.remoteOnly).toBe(false);
    expect(row?.stale).toBe(true);
  });
  test("staleness comes from the remote updated date, not the local one", async () => {
    // Local fixture epic says updated 2026-09-10; remote claim is fresh.
    const repo = await loadPmRepo(await fixture());
    const fresh = new Map([
      [
        "app-performance",
        {
          session: { harness: "pi", claimed: "2026-09-29", branch: "pm/app-performance" },
          updated: "2026-09-29",
          title: "t",
          status: "in-progress",
          owner: "x",
        },
      ],
    ]);
    expect(
      buildStatus(repo, fresh, "ok", { staleDays: 3, today: "2026-09-30" }).rows[0]?.stale,
    ).toBe(false);
    // Reverse: local looks fresh, remote claim is old.
    const stale = new Map([
      [
        "app-performance",
        {
          session: { harness: "pi", claimed: "2026-08-01", branch: "pm/app-performance" },
          updated: "2026-08-01",
          title: "t",
          status: "in-progress",
          owner: "x",
        },
      ],
    ]);
    expect(
      buildStatus(repo, stale, "ok", { staleDays: 3, today: "2026-09-11" }).rows[0]?.stale,
    ).toBe(true);
  });
  test("epics that exist only on a remote claim branch are listed", async () => {
    const repo = await loadPmRepo(await fixture());
    const remote = new Map([
      [
        "brand-new",
        {
          session: { harness: "pi", claimed: "2026-09-14", branch: "pm/brand-new" },
          updated: "2026-09-14",
          title: "Brand new epic",
          status: "approved",
          owner: "someone",
        },
      ],
    ]);
    const report = buildStatus(repo, remote, "ok", OPTS);
    expect(report.rows.map((r) => r.slug)).toEqual(["app-performance", "brand-new"]);
    const row = report.rows[1];
    expect(row?.remoteOnly).toBe(true);
    expect(row?.remoteClaim).toBe(true);
    expect(row?.title).toBe("Brand new epic");
    expect(row?.session?.harness).toBe("pi");
    expect(row?.total).toBe(0);
    expect(formatStatus(report)).toContain(
      "brand-new  approved  owner: someone  session: pi · 2026-09-14 [remote-only]",
    );
  });
  test("lists blocked tasks and formats", async () => {
    const root = await fixture();
    await setStatus(root, "T02-add-order-items-index.md", "blocked");
    const report = buildStatus(await loadPmRepo(root), null, "unreachable", OPTS);
    expect(report.rows[0]?.blocked).toEqual(["T02"]);
    const text = formatStatus(report);
    expect(text).toContain("remote: unreachable");
    expect(text).toContain("app-performance");
    expect(text).toContain("blocked: T02");
    expect(text).toContain("next: T01");
  });
});
