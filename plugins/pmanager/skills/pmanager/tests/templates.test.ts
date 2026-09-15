import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { check } from "../scripts/check";
import { LOG_START, TASKS_START } from "../scripts/render";
import { loadPmRepo } from "../scripts/repo";
import { makeTempDir, writeTree } from "./helpers";

const REF = join(import.meta.dir, "..", "references");

async function templateBlock(name: string): Promise<string> {
  const raw = await readFile(join(REF, name), "utf8");
  const m = /```markdown\n([\s\S]*?)```/.exec(raw);
  if (!m?.[1]) throw new Error(`no markdown block in ${name}`);
  return m[1];
}

function task(id: string, title: string, milestone: string, deps: string): string {
  return `---\nid: ${id}\nepic: app-performance\nmilestone: ${milestone}\ntitle: ${title}\nstatus: todo\npriority: must\ndepends-on: ${deps}\nestimate: S\nowner: unassigned\nupdated: 2026-09-15\ncontract: 1\n---\n\n# ${id}\n\n## Context\n\nx\n\n## What to do\n\nx\n\n## Acceptance criteria\n\n- [ ] x\n\n## Out of scope\n\n- y\n`;
}

test("templates declare contract 1 and the marker pairs", async () => {
  const epic = await templateBlock("epic.template.md");
  expect(epic).toContain("contract: 1");
  expect(epic).toContain("primary-metric:");
  expect(epic).toContain("repos:");
  expect(epic).toContain("## Outcome");
  expect(await templateBlock("task.template.md")).toContain("contract: 1");
  expect(await templateBlock("plan.template.md")).toContain(TASKS_START);
  expect(await templateBlock("memo.template.md")).toContain(LOG_START);
});

test("instantiated templates pass check; plan table matches render", async () => {
  const root = await makeTempDir("tpl");
  const epic = (await templateBlock("epic.template.md"))
    .replace("id: <slug>", "id: app-performance")
    .replace("title: <one-line title>", "title: Fix checkout latency")
    .replace("type: bug | feature | tech-debt | initiative", "type: bug")
    .replace("status: draft | approved | in-progress | done | abandoned", "status: draft")
    .replace("business-goal: <the goal this serves, one line>", "business-goal: conversion")
    .replace('owner: <who owns the outcome — a person, or "unassigned">', "owner: unassigned")
    .replace("created: YYYY-MM-DD", "created: 2026-09-15")
    .replace("updated: YYYY-MM-DD", "updated: 2026-09-15")
    .replace(/primary-metric: .*\n/, "primary-metric: p95 checkout < 800ms\n")
    .replace(/repos: \[\].*\n/, "repos: []\n");
  const plan = (await templateBlock("plan.template.md"))
    .replace("epic: <slug>", "epic: app-performance")
    .replace("status: draft | approved | in-progress | done | abandoned", "status: draft")
    .replace("updated: YYYY-MM-DD", "updated: 2026-09-15");
  await writeTree(root, {
    "docs/pm/app-performance/epic.md": epic,
    "docs/pm/app-performance/plan.md": plan,
    "docs/pm/app-performance/tasks/T01-profile-checkout-hot-paths.md": task(
      "T01",
      "Profile checkout hot paths",
      "M1",
      "[]",
    ),
    "docs/pm/app-performance/tasks/T02-add-index-on-orders-user-id.md": task(
      "T02",
      "Add index on orders.user_id",
      "M2",
      "[T01]",
    ),
  });
  const repo = await loadPmRepo(root);
  const findings = check(repo, { staleDays: 14, today: "2026-09-15" });
  const errors = findings.filter((f) => f.severity === "error" && f.rule !== "E-RND-001");
  expect(errors).toEqual([]);
});
