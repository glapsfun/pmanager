import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import {
  copyFixture,
  gitOk,
  makeTempDir,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY, type Telemetry } from "../adapters/types";
import { type FixtureInfo, gitCommitAll, headSha, snapshotDirty } from "../fixture";
import { buildCheckContext } from "../graders/context";
import { evidenceCitesRepo, metricHasTarget } from "../graders/new-epic";
import { nextNotT03 } from "../graders/tracking";
import { type Check, runChecks } from "../graders/types";

const EPIC = "docs/pm/app-performance/epic.md";

async function edit(dir: string, rel: string, from: string, to: string) {
  const p = join(dir, rel);
  const raw = await readFile(p, "utf8");
  if (!raw.includes(from)) throw new Error(`edit: ${from} not in ${rel}`);
  await writeFile(p, raw.replace(from, to));
}

async function newEpicState() {
  const dir = await makeTempDir("bench-harden");
  await buildWebshopRepo(dir);
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

async function one(dir: string, info: FixtureInfo, check: Check, t: Telemetry = EMPTY_TELEMETRY) {
  const ctx = await buildCheckContext(dir, info, t);
  return (await runChecks([check], ctx))[0];
}

describe("evidence-cites-repo resolves paths", () => {
  test("a citation to a real file passes even without the word pagination", async () => {
    const { dir, info } = await newEpicState();
    await edit(
      dir,
      EPIC,
      "| [git log 2026-07-02] | pagination removed from /orders | behavioral |\n",
      "",
    );
    expect((await one(dir, info, evidenceCitesRepo))?.passed).toBe(true);
  });

  test("citations to files that do not exist fail", async () => {
    const { dir, info } = await newEpicState();
    await edit(dir, EPIC, "[app/app.py:15]", "[src/orders/service.py:15]");
    await edit(dir, EPIC, "[app/schema.sql:12]", "[db/schema.sql:12]");
    const r = await one(dir, info, evidenceCitesRepo);
    expect(r?.passed).toBe(false);
    expect(r?.evidence).toContain("src/orders/service.py");
  });
});

describe("metric-has-target reads the primary row", () => {
  test("a number in the wrong column does not pass", async () => {
    const { dir, info } = await newEpicState();
    await edit(
      dir,
      EPIC,
      "| p95 /orders latency | primary | unknown | < 500ms | 1 week post-ship | benchmark script |",
      "| p95 /orders latency | primary | 3.1s | faster | soon | benchmark script |",
    );
    expect((await one(dir, info, metricHasTarget))?.passed).toBe(false);
  });

  test("a primary row with a comparison target and a duration window passes", async () => {
    const { dir, info } = await newEpicState();
    expect((await one(dir, info, metricHasTarget))?.passed).toBe(true);
  });
});

describe("next-not-t03 uses dependency readiness", () => {
  const tracked = (info: FixtureInfo) => ({ ...info, epicSlugsBefore: ["app-performance"] });

  test("recommending a task whose dependency is not done fails", async () => {
    const { dir, info } = await newEpicState();
    const t = {
      ...EMPTY_TELEMETRY,
      finalMessage: "Tracking updated.\n\nNext up: T03 batch item queries.",
    };
    expect((await one(dir, tracked(info), nextNotT03, t))?.passed).toBe(false);
  });

  test("recommending a ready task passes", async () => {
    const { dir, info } = await newEpicState();
    const t = {
      ...EMPTY_TELEMETRY,
      finalMessage: "Tracking updated.\n\nNext: T04 restore pagination, since T03 waits on T02.",
    };
    expect((await one(dir, tracked(info), nextNotT03, t))?.passed).toBe(true);
  });
});

describe("dirty-tree comparison against the starting state", () => {
  test("an unchanged pre-existing edit is not a change; a modified one is", async () => {
    const dir = await makeTempDir("bench-harden");
    await buildWebshopRepo(dir);
    await writeFile(join(dir, "docs", "notes.txt"), "keep me\n");
    const info: FixtureInfo = {
      baselineSha: await headSha(dir),
      originBare: null,
      originRefs: {},
      epicSlugsBefore: ["app-performance"],
      initialDirty: await snapshotDirty(dir),
    };
    expect(Object.keys(info.initialDirty)).toEqual(["docs/notes.txt"]);
    let ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
    expect(ctx.changedPaths).toEqual([]);
    expect(ctx.dirty).toBe(false);
    await writeFile(join(dir, "docs", "notes.txt"), "changed\n");
    ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
    expect(ctx.changedPaths).toEqual(["docs/notes.txt"]);
    expect(ctx.dirty).toBe(true);
  });

  test("staging an unchanged pre-existing file is a change", async () => {
    const dir = await makeTempDir("bench-harden");
    await buildWebshopRepo(dir);
    await writeFile(join(dir, "docs", "notes.txt"), "keep me\n");
    const info: FixtureInfo = {
      baselineSha: await headSha(dir),
      originBare: null,
      originRefs: {},
      epicSlugsBefore: ["app-performance"],
      initialDirty: await snapshotDirty(dir),
    };
    expect(info.initialDirty["docs/notes.txt"]?.startsWith("??|")).toBe(true);
    await gitOk(["add", "docs/notes.txt"], dir);
    const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
    expect(ctx.changedPaths).toEqual(["docs/notes.txt"]);
    expect(ctx.dirty).toBe(true);
  });

  test("deleting a pre-existing untracked file is a change", async () => {
    const dir = await makeTempDir("bench-harden");
    await buildWebshopRepo(dir);
    await writeFile(join(dir, "docs", "notes.txt"), "keep me\n");
    const info: FixtureInfo = {
      baselineSha: await headSha(dir),
      originBare: null,
      originRefs: {},
      epicSlugsBefore: ["app-performance"],
      initialDirty: await snapshotDirty(dir),
    };
    await rm(join(dir, "docs", "notes.txt"));
    const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
    expect(ctx.changedPaths).toEqual(["docs/notes.txt"]);
    expect(ctx.dirty).toBe(true);
  });

  test("editing or deleting an initially dirty file and committing leaves the tree clean", async () => {
    for (const action of ["edit", "delete"] as const) {
      const dir = await makeTempDir("bench-harden");
      await buildWebshopRepo(dir);
      await writeFile(join(dir, "docs", "notes.txt"), "keep me\n");
      if (action === "delete") await gitCommitAll(dir, "chore: track notes");
      const baselineSha = await headSha(dir);
      if (action === "delete") await writeFile(join(dir, "docs", "notes.txt"), "dirty\n");
      const info: FixtureInfo = {
        baselineSha,
        originBare: null,
        originRefs: {},
        epicSlugsBefore: ["app-performance"],
        initialDirty: await snapshotDirty(dir),
      };
      expect(Object.keys(info.initialDirty)).toEqual(["docs/notes.txt"]);
      if (action === "edit") await writeFile(join(dir, "docs", "notes.txt"), "v2\n");
      else await rm(join(dir, "docs", "notes.txt"));
      await gitCommitAll(dir, `chore: ${action} notes`);
      const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
      expect(ctx.dirty).toBe(false);
      expect(ctx.newCommits).toBe(1);
      expect(ctx.changedPaths).toEqual(["docs/notes.txt"]);
    }
  });
});
