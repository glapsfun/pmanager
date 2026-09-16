import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyRender } from "../../plugins/pmanager/skills/pmanager/scripts/render";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY, type Telemetry } from "../adapters/types";
import { type FixtureInfo, headSha, snapshotDirty } from "../fixture";
import { buildCheckContext } from "../graders/context";
import { trackingChecks } from "../graders/tracking";
import { runChecks } from "../graders/types";

const T01 = "docs/pm/app-performance/tasks/T01-benchmark-orders.md";
const T02 = "docs/pm/app-performance/tasks/T02-add-order-items-index.md";

async function edit(dir: string, rel: string, from: string, to: string) {
  const p = join(dir, rel);
  const raw = await readFile(p, "utf8");
  if (!raw.includes(from)) throw new Error(`edit: ${from} not in ${rel}`);
  await writeFile(p, raw.replace(from, to));
}

async function fixture() {
  const dir = await makeTempDir("bench-tracking");
  await buildWebshopRepo(dir);
  await writeFile(join(dir, "docs", "profile-results.txt"), "85% in item queries\n");
  const info: FixtureInfo = {
    baselineSha: await headSha(dir),
    originBare: null,
    originRefs: {},
    epicSlugsBefore: ["app-performance"],
    initialDirty: await snapshotDirty(dir),
  };
  return { dir, info };
}

async function goodUpdate(dir: string) {
  await edit(dir, T01, "status: todo", "status: done");
  await edit(dir, T01, "updated: 2026-09-10", "updated: 2026-09-15");
  await edit(dir, T01, "- [ ] A results file", "- [x] A results file");
  await edit(dir, T01, "- [ ] The share", "- [x] The share");
  await edit(dir, T01, "## Notes\n", "## Notes\n\nEvidence: docs/profile-results.txt\n");
  await edit(dir, T02, "status: todo", "status: blocked");
  await edit(dir, T02, "updated: 2026-09-10", "updated: 2026-09-15");
  await edit(dir, T02, "## Notes\n", "## Notes\n\nBlocked: waiting on DBA review.\n");
  await applyRender(await loadPmRepo(dir));
}

async function outcomes(dir: string, info: FixtureInfo, telemetry: Telemetry = EMPTY_TELEMETRY) {
  const ctx = await buildCheckContext(dir, info, telemetry);
  const res = await runChecks(trackingChecks(), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

describe("tracking checks", () => {
  test("a correct update passes; message checks are skipped without a final message", async () => {
    const { dir, info } = await fixture();
    await goodUpdate(dir);
    const o = await outcomes(dir, info);
    expect(o).toEqual({
      "no-new-epic": true,
      "t01-done": true,
      "t02-blocked-noted": true,
      "table-mirrors": true,
      "index-counts": true,
      "next-not-t03": null,
      "verified-evidence": true,
    });
  });

  test("final message recommending T03 fails, naming T04 passes", async () => {
    const { dir, info } = await fixture();
    await goodUpdate(dir);
    const bad = { ...EMPTY_TELEMETRY, finalMessage: "Next: pick up T03 batch item queries." };
    expect((await outcomes(dir, info, bad))["next-not-t03"]).toBe(false);
    const good = {
      ...EMPTY_TELEMETRY,
      finalMessage: "T03 waits on T02 (blocked on DBA). Next: T04 restore pagination.",
    };
    expect((await outcomes(dir, info, good))["next-not-t03"]).toBe(true);
  });

  test("untouched fixture fails the state checks", async () => {
    const { dir, info } = await fixture();
    const o = await outcomes(dir, info);
    expect(o["t01-done"]).toBe(false);
    expect(o["t02-blocked-noted"]).toBe(false);
    expect(o["index-counts"]).toBe(false);
    expect(o["verified-evidence"]).toBe(false);
    expect(o["no-new-epic"]).toBe(true);
  });

  test("unrendered table fails table-mirrors", async () => {
    const { dir, info } = await fixture();
    await goodUpdate(dir);
    await edit(
      dir,
      "docs/pm/app-performance/plan.md",
      "| T01 | Benchmark orders endpoint | M1 | must | — | done |",
      "| T01 | Benchmark orders endpoint | M1 | must | — | todo |",
    );
    expect((await outcomes(dir, info))["table-mirrors"]).toBe(false);
  });
});
