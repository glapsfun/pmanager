import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { copyFixture, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY } from "../adapters/types";
import { type FixtureInfo, gitCommitAll, headSha } from "../fixture";
import { buildCheckContext } from "../graders/context";
import { newEpicChecks } from "../graders/new-epic";
import { runChecks } from "../graders/types";

const EPIC = "docs/pm/app-performance/epic.md";
const T01 = "docs/pm/app-performance/tasks/T01-benchmark-orders.md";

async function goodRun() {
  const dir = await makeTempDir("bench-newepic");
  await buildWebshopRepo(dir);
  await rm(join(dir, "docs", "pm"), { recursive: true });
  await gitCommitAll(dir, "chore: drop docs/pm");
  const info: FixtureInfo = {
    baselineSha: await headSha(dir),
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [],
    initialDirty: {},
  };
  await copyFixture(dir);
  return { dir, info };
}

async function edit(dir: string, rel: string, from: string, to: string) {
  const p = join(dir, rel);
  const raw = await readFile(p, "utf8");
  if (!raw.includes(from)) throw new Error(`edit: ${from} not in ${rel}`);
  await writeFile(p, raw.replace(from, to));
}

async function outcomes(dir: string, info: FixtureInfo, variant: "perf" | "feature") {
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(newEpicChecks(variant), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

describe("new-epic checks", () => {
  test("fixture docs restored as a draft pass every perf check", async () => {
    const { dir, info } = await goodRun();
    await edit(dir, EPIC, "status: in-progress", "status: draft");
    const o = await outcomes(dir, info, "perf");
    expect(o).toEqual({
      "epic-and-plan": true,
      "tasks-min-3": true,
      "binary-acceptance": true,
      "evidence-cites-repo": true,
      "metric-has-target": true,
      "non-goals": true,
      "draft-awaits-approval": true,
      "riskiest-first": true,
    });
  });

  test("feature variant swaps the perf-only checks for confidence-not-high", async () => {
    const { dir, info } = await goodRun();
    await edit(dir, EPIC, "status: in-progress", "status: draft");
    const o = await outcomes(dir, info, "feature");
    expect(o["evidence-cites-repo"]).toBeUndefined();
    expect(o["riskiest-first"]).toBeUndefined();
    expect(o["confidence-not-high"]).toBe(true);
    await edit(dir, EPIC, "**Confidence:** medium", "**Confidence:** high");
    expect((await outcomes(dir, info, "feature"))["confidence-not-high"]).toBe(false);
  });

  test("bad states fail the matching check", async () => {
    const { dir, info } = await goodRun();
    expect((await outcomes(dir, info, "perf"))["draft-awaits-approval"]).toBe(false);
    await edit(dir, EPIC, "status: in-progress", "status: draft");
    await edit(
      dir,
      EPIC,
      "| [app/app.py:15] | N+1 query per order in /orders | behavioral |\n",
      "",
    );
    await edit(
      dir,
      EPIC,
      "| [app/schema.sql:12] | no index on order_items.order_id | behavioral |\n",
      "",
    );
    await edit(
      dir,
      EPIC,
      "| [git log 2026-07-02] | pagination removed from /orders | behavioral |\n",
      "",
    );
    expect((await outcomes(dir, info, "perf"))["evidence-cites-repo"]).toBe(false);
    await edit(dir, EPIC, "- Storage-layer rewrite — out of proportion to the evidence.\n", "");
    expect((await outcomes(dir, info, "perf"))["non-goals"]).toBe(false);
    await edit(
      dir,
      EPIC,
      "| p95 /orders latency | primary | unknown | < 500ms | 1 week post-ship | benchmark script |\n",
      "",
    );
    await edit(dir, EPIC, "| /orders error rate | guardrail | 0% | 0% | same | app logs |\n", "");
    expect((await outcomes(dir, info, "perf"))["metric-has-target"]).toBe(false);
    await edit(dir, T01, "title: Benchmark orders endpoint", "title: Add cache");
    expect((await outcomes(dir, info, "perf"))["riskiest-first"]).toBe(false);
    await edit(dir, T01, "- [ ] A results file records p50/p95 for /orders\n", "");
    await edit(
      dir,
      T01,
      "- [ ] The share of time spent in item queries is reported as a percentage\n",
      "",
    );
    expect((await outcomes(dir, info, "perf"))["binary-acceptance"]).toBe(false);
    await rm(join(dir, "docs", "pm", "app-performance", "tasks", "T04-restore-pagination.md"));
    await rm(join(dir, "docs", "pm", "app-performance", "tasks", "T03-batch-item-queries.md"));
    expect((await outcomes(dir, info, "perf"))["tasks-min-3"]).toBe(false);
    await rm(join(dir, "docs", "pm", "app-performance", "plan.md"));
    expect((await outcomes(dir, info, "perf"))["epic-and-plan"]).toBe(false);
  });
});
