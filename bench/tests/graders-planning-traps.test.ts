import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY } from "../adapters/types";
import { buildCheckContext } from "../graders/context";
import { planningTrapChecks } from "../graders/planning-traps";
import { runChecks } from "../graders/types";
import { buildPlanningTrapsFixture, planningTraps, TRAP_FILES } from "../scenarios/planning-traps";

const DIR = "docs/pm/order-status";

const EPIC = `---
id: order-status
title: Order status and exact totals
type: feature
status: draft
business-goal: Fewer where-is-my-order contacts
owner: unassigned
created: 2026-09-15
updated: 2026-09-15
contract: 1
repos:
  - git@github.com:glapsfun/webshop.git
  - https://github.com/acme/shop-ios
primary-metric: where-is-my-order tickets -30%
---

# Order status and exact totals

## Problem statement (required)

Customers cannot see order status; totals are floats.

## Evidence (required)

| Source | Finding | Kind |
| :--- | :--- | :--- |
| [app/schema.sql:4] | total is REAL | behavioral |

**Confidence:** medium

## Scope

- status and total_cents in GET /orders

## Non-goals (required)

- Carrier choice.
`;

const PLAN = `---
epic: order-status
status: draft
updated: 2026-09-15
contract: 1
---

# Plan

## Milestones

### M1 — Columns in place
Exit criteria:
- [ ] migration 002 applies on a copy of production

### M2 — Status visible
Exit criteria:
- [ ] \`GET /orders\` returns status for every order

### M3 — Live updates
Exit criteria:
- [ ] a ShipFast sandbox event updates one order

## Dependencies

| Dependency | Kind | Owner | Status |
| :--- | :--- | :--- | :--- |
| ShipFast credentials (OPS-112) | external | ops | pending |
`;

interface T {
  id: string;
  title: string;
  milestone: string;
  deps: string[];
  status?: string;
  body?: string;
  acceptance?: string;
}

const TASKS: T[] = [
  { id: "T01", title: "Add status and total_cents columns", milestone: "M1", deps: [] },
  {
    id: "T02",
    title: "Backfill status and total_cents for existing orders",
    milestone: "M1",
    deps: ["T01"],
  },
  {
    id: "T03",
    title: "Serve status and exact totals in GET /orders",
    milestone: "M2",
    deps: ["T02"],
  },
  { id: "T04", title: "Show status on the orders page", milestone: "M2", deps: ["T03"] },
  {
    id: "T05",
    title: "Show status in the iOS app",
    milestone: "M3",
    deps: ["T03"],
    body: "Lives in shop-ios.",
  },
  {
    id: "T06",
    title: "Receive ShipFast webhooks",
    milestone: "M3",
    deps: ["T01"],
    status: "blocked",
    body: "Waits for credentials.",
  },
];

function taskDoc(t: T): string {
  return `---
id: ${t.id}
epic: order-status
milestone: ${t.milestone}
title: ${t.title}
status: ${t.status ?? "todo"}
priority: must
depends-on: [${t.deps.join(", ")}]
estimate: S
owner: unassigned
updated: 2026-09-15
contract: 1
---

# ${t.id} — ${t.title}

## What to do

${t.body ?? "As titled."}

## Acceptance criteria

${t.acceptance ?? "- [ ] `pytest tests/test_orders.py` passes"}
`;
}

async function fixture(tasks: T[] = TASKS) {
  const dir = await makeTempDir("bench-traps");
  const info = await buildPlanningTrapsFixture(dir);
  await mkdir(join(dir, DIR, "tasks"), { recursive: true });
  await writeFile(join(dir, DIR, "epic.md"), EPIC);
  await writeFile(join(dir, DIR, "plan.md"), PLAN);
  for (const t of tasks) await writeFile(join(dir, DIR, "tasks", `${t.id}-x.md`), taskDoc(t));
  return { dir, info };
}

async function outcomes(dir: string, info: Awaited<ReturnType<typeof fixture>>["info"]) {
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(planningTrapChecks(), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

function withTask(id: string, change: Partial<T>): T[] {
  return TASKS.map((t) => (t.id === id ? { ...t, ...change } : t));
}

async function edit(dir: string, rel: string, from: string, to: string) {
  const p = join(dir, rel);
  const raw = await readFile(p, "utf8");
  if (!raw.includes(from)) throw new Error(`edit: ${from} not in ${rel}`);
  await writeFile(p, raw.replace(from, to));
}

describe("planning-traps fixture", () => {
  test("holds every trap file in one commit after the webshop history, with a clean tree", async () => {
    const dir = await makeTempDir("bench-traps");
    const info = await buildPlanningTrapsFixture(dir);
    for (const [rel, body] of Object.entries(TRAP_FILES)) {
      expect(await readFile(join(dir, rel), "utf8")).toBe(body);
    }
    expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
    expect((await gitOk(["log", "--oneline"], dir)).trim().split("\n")).toHaveLength(4);
    expect((await gitOk(["log", "--all", "--oneline", "--", "docs/pm"], dir)).trim()).toBe("");
    expect(info.baselineSha).toBe((await gitOk(["rev-parse", "HEAD"], dir)).trim());
  });

  test("the request names neither a trap nor the skill", () => {
    for (const word of ["migration", "backfill", "shop-ios", "OPS-112", "ShipFast", "pmanager"]) {
      expect(planningTraps.task.includes(word)).toBe(false);
    }
  });
});

describe("planning-trap checks", () => {
  test("a plan that handles every trap passes every check", async () => {
    const { dir, info } = await fixture();
    const o = await outcomes(dir, info);
    expect(Object.keys(o)).toHaveLength(7);
    expect(Object.values(o).every((v) => v === true)).toBe(true);
  });

  test("a status task that skips the migration fails migration-first and backfill", async () => {
    const { dir, info } = await fixture(withTask("T03", { deps: [] }));
    const o = await outcomes(dir, info);
    expect(o["migration-first"]).toBe(false);
    expect(o["backfill-before-reads"]).toBe(false);
  });

  test("research tasks naming status or totals are not readers", async () => {
    const { dir, info } = await fixture([
      ...TASKS,
      {
        id: "T07",
        title: "Confirm ShipFast credential status (OPS-112)",
        milestone: "M1",
        deps: [],
      },
      {
        id: "T08",
        title: "Spike: locate the orders page and the total write path",
        milestone: "M1",
        deps: [],
      },
    ]);
    const o = await outcomes(dir, info);
    expect(o["migration-first"]).toBe(true);
    expect(o["backfill-before-reads"]).toBe(true);
  });

  test("no migration task fails migration-first", async () => {
    const { dir, info } = await fixture(withTask("T01", { title: "Add order fields" }));
    expect((await outcomes(dir, info))["migration-first"]).toBe(false);
  });

  test("reading after the migration but before the backfill fails only backfill", async () => {
    const { dir, info } = await fixture(withTask("T03", { deps: ["T01"] }));
    const o = await outcomes(dir, info);
    expect(o["migration-first"]).toBe(true);
    expect(o["backfill-before-reads"]).toBe(false);
  });

  test("a backfill inside the migration task counts", async () => {
    const tasks = TASKS.filter((t) => t.id !== "T02").map((t) =>
      t.id === "T01"
        ? { ...t, body: "Migration 002 adds the columns and backfills existing rows." }
        : t.id === "T03"
          ? { ...t, deps: ["T01"] }
          : t,
    );
    const { dir, info } = await fixture(tasks);
    expect((await outcomes(dir, info))["backfill-before-reads"]).toBe(true);
  });

  test("a totals task that backfills in its own steps passes backfill-before-reads", async () => {
    const tasks = TASKS.filter((t) => t.id !== "T02").map((t) =>
      t.id === "T01"
        ? { ...t, title: "Add status column with default placed" }
        : t.id === "T03"
          ? {
              ...t,
              deps: ["T01"],
              body: "Add total_cents, backfill it from total, then serve it.",
            }
          : t,
    );
    const { dir, info } = await fixture(tasks);
    expect((await outcomes(dir, info))["backfill-before-reads"]).toBe(true);
  });

  test("no backfill anywhere fails backfill-before-reads", async () => {
    const { dir, info } = await fixture(
      TASKS.filter((t) => t.id !== "T02").map((t) =>
        t.id === "T03" ? { ...t, deps: ["T01"] } : t,
      ),
    );
    expect((await outcomes(dir, info))["backfill-before-reads"]).toBe(false);
  });

  test("shop-ios missing from repos and tasks fails consumer-repo-named", async () => {
    const { dir, info } = await fixture(withTask("T05", { body: "Update the app." }));
    await edit(dir, `${DIR}/epic.md`, "  - https://github.com/acme/shop-ios\n", "");
    expect((await outcomes(dir, info))["consumer-repo-named"]).toBe(false);
  });

  test("shop-ios named only by a task passes consumer-repo-named", async () => {
    const { dir, info } = await fixture();
    await edit(dir, `${DIR}/epic.md`, "  - https://github.com/acme/shop-ios\n", "");
    expect((await outcomes(dir, info))["consumer-repo-named"]).toBe(true);
  });

  test("no compatible path for totals fails total-change-compatible", async () => {
    const { dir, info } = await fixture(
      TASKS.map((t) => ({ ...t, title: t.title.replace("total_cents", "totals") })),
    );
    await edit(
      dir,
      `${DIR}/epic.md`,
      "- status and total_cents in",
      "- status and integer total in",
    );
    expect((await outcomes(dir, info))["total-change-compatible"]).toBe(false);
  });

  test("OPS-112 absent and the webhook task ready fails blocker-recorded", async () => {
    const { dir, info } = await fixture(withTask("T06", { status: "todo" }));
    await edit(dir, `${DIR}/plan.md`, "ShipFast credentials (OPS-112)", "ShipFast credentials");
    expect((await outcomes(dir, info))["blocker-recorded"]).toBe(false);
  });

  test("OPS-112 named in a task passes blocker-recorded", async () => {
    const { dir, info } = await fixture(
      withTask("T06", { status: "todo", body: "Needs OPS-112 credentials." }),
    );
    await edit(dir, `${DIR}/plan.md`, "ShipFast credentials (OPS-112)", "ShipFast credentials");
    expect((await outcomes(dir, info))["blocker-recorded"]).toBe(true);
  });

  test("a vague acceptance line fails acceptance-testable; a measured one passes", async () => {
    const vague = await fixture(
      withTask("T04", { acceptance: "- [ ] The orders page feels nicer" }),
    );
    expect((await outcomes(vague.dir, vague.info))["acceptance-testable"]).toBe(false);
    const measured = await fixture(
      withTask("T04", { acceptance: "- [ ] The orders page feels faster: p95 under 300ms" }),
    );
    expect((await outcomes(measured.dir, measured.info))["acceptance-testable"]).toBe(true);
  });

  test("a vague milestone exit criterion fails acceptance-testable", async () => {
    const { dir, info } = await fixture();
    await edit(
      dir,
      `${DIR}/plan.md`,
      "- [ ] a ShipFast sandbox event updates one order",
      "- [ ] status updates work properly",
    );
    expect((await outcomes(dir, info))["acceptance-testable"]).toBe(false);
  });

  test("a dependency on a later milestone fails deps-follow-milestones", async () => {
    const { dir, info } = await fixture(withTask("T04", { deps: ["T03", "T05"] }));
    expect((await outcomes(dir, info))["deps-follow-milestones"]).toBe(false);
  });
});
