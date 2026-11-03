import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY } from "../adapters/types";
import { buildCheckContext } from "../graders/context";
import { memoryRecallChecks, newSpecLog } from "../graders/memory-recall";
import { runChecks } from "../graders/types";
import { buildMemoryRecallFixture, STALE_MEMO_LINE } from "../scenarios/memory-recall-fixture";

const DIR = "docs/pm/restock-alerts";

interface T {
  id: string;
  title: string;
  deps: string[];
  body?: string;
}

interface Sample {
  tasks: T[];
  related: string;
  evidence?: string;
  note?: string;
  planDeps?: string;
  milestone?: string;
}

const GOOD_TASKS: T[] = [
  {
    id: "T01",
    title: "Get Legal sign-off for the restock email template (LEGAL-REVIEW)",
    deps: [],
  },
  { id: "T02", title: "Add notify-me subscriptions on sold-out product pages", deps: [] },
  {
    id: "T03",
    title: "Send restock emails",
    deps: ["T01", "T02"],
    body: 'Call `mailer.send(email, "restock", stream="bulk")` when stock goes above zero.',
  },
  {
    id: "T04",
    title: "Roll out to 10% via config/flags.yaml rollout_percent",
    deps: ["T03"],
  },
];

const GOOD: Sample = {
  tasks: GOOD_TASKS,
  related: "- deals-newsletter: mail the shopper's order did not trigger goes on the bulk stream.",
  note: "The memo still names LaunchDarkly, which flags-in-repo removed.",
};

const NO_MEMORY: Sample = {
  tasks: [
    { id: "T01", title: "Add notify-me subscriptions", deps: [] },
    { id: "T02", title: "Send restock emails with mailer.send", deps: ["T01"] },
    { id: "T03", title: "Create a LaunchDarkly flag for a 10% rollout", deps: ["T02"] },
  ],
  related: "- restock-forecast: stock counts come from the warehouse each night.",
};

function epicDoc(s: Sample): string {
  return `---
id: restock-alerts
title: Back-in-stock alerts
type: feature
status: draft
owner: unassigned
created: 2026-09-15
updated: 2026-09-15
contract: 1
repos:
  - git@github.com:glapsfun/webshop.git
primary-metric: restocked items bought by alerted shoppers >= 10%
---

# Back-in-stock alerts

## Problem statement

Shoppers ask to hear when sold-out items return.

## Evidence

| Source | Finding | Kind |
| :--- | :--- | :--- |
| [app/catalog.py:14] | product pages report sold_out | behavioral |
${s.evidence ?? ""}

${s.note ?? ""}

## Hypothesis

We believe restock alerts will bring shoppers back.

## Success metrics

| Metric | Role | Current | Target | Window | Measured via |
| :--- | :--- | :--- | :--- | :--- | :--- |
| alert conversion | primary | none | >= 10% | 4 weeks | dashboard |

## Non-goals

- Price-drop alerts.

## Related prior work

${s.related}
`;
}

function planDoc(s: Sample): string {
  return `---
epic: restock-alerts
status: draft
updated: 2026-09-15
contract: 1
---

# Plan

## Milestones

### M1: Alerts live
Exit criteria:
- [ ] 10% of shoppers get alerts
${s.milestone ?? ""}
## Dependencies

| Dependency | Kind | Owner | Status |
| :--- | :--- | :--- | :--- |
${s.planDeps ?? "| none | | | |"}
`;
}

function taskDoc(t: T): string {
  return `---
id: ${t.id}
epic: restock-alerts
milestone: M1
title: ${t.title}
status: todo
priority: must
depends-on: [${t.deps.join(", ")}]
estimate: S
owner: unassigned
updated: 2026-09-15
contract: 1
---

# ${t.id}: ${t.title}

## What to do

${t.body ?? "As titled."}

## Acceptance criteria

- [ ] \`pytest tests/test_alerts.py\` passes
`;
}

async function fixture(s: Sample) {
  const dir = await makeTempDir("bench-recall-graders");
  const info = await buildMemoryRecallFixture(dir);
  await mkdir(join(dir, DIR, "tasks"), { recursive: true });
  await writeFile(join(dir, DIR, "epic.md"), epicDoc(s));
  await writeFile(join(dir, DIR, "plan.md"), planDoc(s));
  for (const t of s.tasks) await writeFile(join(dir, DIR, "tasks", `${t.id}-x.md`), taskDoc(t));
  return { dir, info };
}

async function outcomes(s: Sample, after?: (dir: string) => Promise<void>) {
  const { dir, info } = await fixture(s);
  if (after) await after(dir);
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(memoryRecallChecks(), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

function withTask(tasks: T[], id: string, change: Partial<T>): T[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...change } : t));
}

const TRAP_CHECKS = [
  "memo-lesson-applied",
  "prior-epic-cited",
  "prior-lesson-applied",
  "stale-not-followed",
] as const;

describe("memory-recall checks", () => {
  test("a plan that handles every trap passes every check", async () => {
    expect(await outcomes(GOOD)).toEqual({
      "memo-lesson-applied": true,
      "prior-epic-cited": true,
      "prior-lesson-applied": true,
      "stale-not-followed": true,
      "stale-flagged": true,
      "near-miss-not-cited": true,
    });
  });

  test("a plan written as if no memory existed fails every trap check", async () => {
    const o = await outcomes(NO_MEMORY);
    for (const id of TRAP_CHECKS) expect({ id, passed: o[id] }).toEqual({ id, passed: false });
    expect(o["stale-flagged"]).toBe(false);
    expect(o["near-miss-not-cited"]).toBe(false);
  });

  test("silent plan fails every trap check", async () => {
    const tasks = GOOD_TASKS.filter((t) => t.id !== "T01" && t.id !== "T04").map((t) =>
      t.id === "T03" ? { ...t, deps: ["T02"], body: "Send when stock goes above zero." } : t,
    );
    const o = await outcomes({ tasks, related: "none" });
    for (const id of TRAP_CHECKS) expect({ id, passed: o[id] }).toEqual({ id, passed: false });
  });

  test("a line that retires LaunchDarkly is not reliance", async () => {
    const tasks = withTask(GOOD_TASKS, "T04", {
      body: "LaunchDarkly was removed; use config/flags.yaml.",
    });
    const o = await outcomes({ ...GOOD, tasks, note: "" });
    expect(o["stale-not-followed"]).toBe(true);
    expect(o["stale-flagged"]).toBe(true);
  });

  test("a Legal task the send task does not wait for fails, a transitive wait passes", async () => {
    const loose = withTask(GOOD_TASKS, "T03", { deps: ["T02"] });
    expect((await outcomes({ ...GOOD, tasks: loose }))["memo-lesson-applied"]).toBe(false);
    const chain = withTask(withTask(GOOD_TASKS, "T03", { deps: ["T02"] }), "T02", {
      deps: ["T01"],
    });
    expect((await outcomes({ ...GOOD, tasks: chain }))["memo-lesson-applied"]).toBe(true);
    const viaPlan = {
      ...GOOD,
      tasks: loose,
      planDeps:
        "| Legal sign-off on the restock template (LEGAL-REVIEW) | internal | legal | pending |",
    };
    expect((await outcomes(viaPlan))["memo-lesson-applied"]).toBe(true);
    const inTask = withTask(
      GOOD_TASKS.filter((t) => t.id !== "T01"),
      "T03",
      {
        deps: ["T02"],
        body: 'File a LEGAL-REVIEW ticket for the template first, then call `mailer.send(email, "restock", stream="bulk")`.',
      },
    );
    expect((await outcomes({ ...GOOD, tasks: inTask }))["memo-lesson-applied"]).toBe(true);
  });

  test("a task that also sends on the transactional stream fails prior-lesson-applied", async () => {
    const extra: T = {
      id: "T05",
      title: "Send a reminder after three days",
      deps: ["T03"],
      body: 'Use `stream="transactional"` for the reminder.',
    };
    expect(
      (await outcomes({ ...GOOD, tasks: [...GOOD_TASKS, extra] }))["prior-lesson-applied"],
    ).toBe(false);
    const negated = { ...extra, body: "Use the bulk stream, not the transactional stream." };
    expect(
      (await outcomes({ ...GOOD, tasks: [...GOOD_TASKS, negated] }))["prior-lesson-applied"],
    ).toBe(true);
  });

  test("citing the lesson epic outside Related prior work does not count", async () => {
    const o = await outcomes({
      ...GOOD,
      related: "none",
      evidence: "| [docs/pm/deals-newsletter/epic.md] | bulk stream for non-order mail | stated |",
    });
    expect(o["prior-epic-cited"]).toBe(false);
  });

  test("a run that corrects the memo line counts as flagged", async () => {
    const o = await outcomes({ ...GOOD, note: "" }, async (dir) => {
      const p = join(dir, "docs/pm/pmanager-memo.md");
      const raw = await readFile(p, "utf8");
      await writeFile(
        p,
        raw.replace(
          STALE_MEMO_LINE,
          "Feature flags live in `config/flags.yaml`. [flags-in-repo, 2026-08-22]",
        ),
      );
    });
    expect(o["stale-flagged"]).toBe(true);
  });

  test("check kinds match the design", () => {
    expect(memoryRecallChecks().map((c) => [c.id, c.kind])).toEqual([
      ["memo-lesson-applied", "outcome"],
      ["prior-epic-cited", "outcome"],
      ["prior-lesson-applied", "outcome"],
      ["stale-not-followed", "outcome"],
      ["stale-flagged", "diagnostic"],
      ["near-miss-not-cited", "diagnostic"],
    ]);
  });
});

const BULK_SEND = 'Call `mailer.send(email, "restock", stream="bulk")` for each subscriber.';

function line(id: string, body: string): T[] {
  return withTask(GOOD_TASKS, id, { body });
}

describe("memory-recall checks on reviewer wordings", () => {
  test("template, then Legal, then send passes memo-lesson-applied", async () => {
    const tasks: T[] = [
      { id: "T01", title: "Write the restock email template", deps: [] },
      { id: "T02", title: "Legal review of the restock template (LEGAL-REVIEW)", deps: ["T01"] },
      { id: "T03", title: "Send restock emails", deps: ["T02"], body: BULK_SEND },
      { id: "T04", title: "Roll out to 10% via config/flags.yaml", deps: ["T03"] },
    ];
    expect((await outcomes({ ...GOOD, tasks }))["memo-lesson-applied"]).toBe(true);
  });

  test("a notify-me capture task needs no Legal edge", async () => {
    for (const title of [
      "Capture notify-me requests on sold-out product pages",
      "Add a Notify me button on sold-out product pages",
    ]) {
      const tasks = withTask(GOOD_TASKS, "T02", { title });
      expect({ title, ok: (await outcomes({ ...GOOD, tasks }))["memo-lesson-applied"] }).toEqual({
        title,
        ok: true,
      });
    }
  });

  test("notify and worker send tasks pass through a Legal Dependencies row, and fail without it", async () => {
    const tasks: T[] = [
      { id: "T01", title: "Add notify-me subscriptions", deps: [] },
      { id: "T02", title: "Notify subscribers when an item is restocked", deps: ["T01"] },
      { id: "T03", title: "Restock alert worker job", deps: ["T02"], body: BULK_SEND },
    ];
    const planDeps =
      "| Legal sign-off on the restock template (LEGAL-REVIEW) | internal | legal | pending |";
    expect((await outcomes({ ...GOOD, tasks, planDeps }))["memo-lesson-applied"]).toBe(true);
    expect((await outcomes({ ...GOOD, tasks }))["memo-lesson-applied"]).toBe(false);
  });

  test("lines about the transactional stream that are not send instructions are not reliance", async () => {
    for (const extra of [
      "Per deals-newsletter, the transactional stream is for order mail only.",
      "## Out of scope\n\n- Order confirmations stay on the transactional stream.",
      "deals-newsletter went out on the transactional stream and landed in spam.",
    ]) {
      const tasks = line("T03", `${BULK_SEND}\n\n${extra}`);
      expect({ extra, ok: (await outcomes({ ...GOOD, tasks }))["prior-lesson-applied"] }).toEqual({
        extra,
        ok: true,
      });
    }
  });

  test("the bulk stream named with backticks or stream: counts", async () => {
    for (const body of [
      "Send each alert on the `bulk` stream.",
      "Mailer call uses `stream: bulk`.",
    ]) {
      const tasks = line("T03", body);
      expect({ body, ok: (await outcomes({ ...GOOD, tasks }))["prior-lesson-applied"] }).toEqual({
        body,
        ok: true,
      });
    }
  });

  test("flag wordings that use the in-repo flags pass stale-not-followed", async () => {
    const moved = line(
      "T04",
      "flags-in-repo moved every flag out of LaunchDarkly, so add it to config/flags.yaml.",
    );
    expect((await outcomes({ ...GOOD, tasks: moved }))["stale-not-followed"]).toBe(true);
    const short = withTask(GOOD_TASKS, "T04", {
      title: "Add a restock_alerts flag to flags.yaml at 10%",
    });
    expect((await outcomes({ ...GOOD, tasks: short }))["stale-not-followed"]).toBe(true);
  });

  test("a milestone naming a LaunchDarkly rollout fails stale-not-followed", async () => {
    const milestone =
      "\n### M2: 10% LaunchDarkly rollout\nExit criteria:\n- [ ] 10% of shoppers see the option\n";
    expect((await outcomes({ ...GOOD, milestone }))["stale-not-followed"]).toBe(false);
  });

  test("citing the lesson epic by its title counts", async () => {
    const related =
      "- Weekly deals newsletter: mail the shopper's order did not trigger goes on the bulk stream.";
    expect((await outcomes({ ...GOOD, related }))["prior-epic-cited"]).toBe(true);
  });

  test("citing the near miss next to the lesson epic is not a miss", async () => {
    const related = `${GOOD.related}\n- restock-forecast: stock counts come from the warehouse.`;
    expect((await outcomes({ ...GOOD, related }))["near-miss-not-cited"]).toBe(true);
  });

  test("new-spec-log needs a spec log entry for an epic that is not a prior one", async () => {
    const { dir, info } = await fixture(GOOD);
    const before = await runChecks(
      [newSpecLog],
      await buildCheckContext(dir, info, EMPTY_TELEMETRY),
    );
    expect(before[0]?.passed).toBe(false);
    await writeFile(
      join(dir, "docs/pm/log/2026-09-15-restock-alerts-abc123.md"),
      "---\ndate: 2026-09-15\nepic: restock-alerts\nharness: claude-code\nkind: spec\n---\nspec restock-alerts\n",
    );
    const after = await runChecks(
      [newSpecLog],
      await buildCheckContext(dir, info, EMPTY_TELEMETRY),
    );
    expect(after[0]?.passed).toBe(true);
    expect(newSpecLog.kind).toBe("contract");
  });
});
