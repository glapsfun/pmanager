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
      ["app-performance", { harness: "pi", claimed: "2026-08-01", branch: "pm/app-performance" }],
    ]);
    const report = buildStatus(repo, remote, "ok", { staleDays: 3, today: "2026-09-30" });
    const row = report.rows[0];
    expect(row?.session?.harness).toBe("pi");
    expect(row?.remoteClaim).toBe(true);
    expect(row?.stale).toBe(true);
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
