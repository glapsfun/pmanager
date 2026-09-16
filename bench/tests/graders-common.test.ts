import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY } from "../adapters/types";
import { type FixtureInfo, gitCommitAll, headSha } from "../fixture";
import { commonChecks } from "../graders/common";
import { buildCheckContext } from "../graders/context";
import { runChecks } from "../graders/types";

async function webshop() {
  const dir = await makeTempDir("bench-graders");
  await buildWebshopRepo(dir);
  const info: FixtureInfo = {
    baselineSha: await headSha(dir),
    originBare: null,
    originRefs: {},
    epicSlugsBefore: ["app-performance"],
    ignorePaths: [],
  };
  return { dir, info };
}

async function outcomes(dir: string, info: FixtureInfo) {
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(commonChecks("spec"), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

describe("common checks", () => {
  test("untouched clean fixture: check passes, nothing committed", async () => {
    const { dir, info } = await webshop();
    const o = await outcomes(dir, info);
    expect(o["check-no-errors"]).toBe(true);
    expect(o["index-present"]).toBe(true);
    expect(o["memo-present"]).toBe(true);
    expect(o["log-entry"]).toBe(true);
    expect(o["scoped-diff"]).toBe(true);
    expect(o.committed).toBe(false);
  });

  test("a commit touching app code fails scoped-diff; a docs commit passes", async () => {
    const { dir, info } = await webshop();
    await writeFile(join(dir, "app", "extra.py"), "x = 1\n");
    await gitCommitAll(dir, "chore: touch app");
    let o = await outcomes(dir, info);
    expect(o["scoped-diff"]).toBe(false);
    expect(o.committed).toBe(true);
    await gitOk(["reset", "-q", "--hard", info.baselineSha], dir);
    await writeFile(join(dir, "docs", "pm", "note.md"), "note\n");
    await gitCommitAll(dir, "docs(pm): note");
    o = await outcomes(dir, info);
    expect(o["scoped-diff"]).toBe(true);
  });

  test("dirty tree fails committed; ignored paths are excluded from the diff", async () => {
    const { dir, info } = await webshop();
    await writeFile(join(dir, "docs", "profile-results.txt"), "85%\n");
    let o = await outcomes(dir, info);
    expect(o["scoped-diff"]).toBe(false);
    o = await outcomes(dir, { ...info, ignorePaths: ["docs/profile-results.txt"] });
    expect(o["scoped-diff"]).toBe(true);
    expect(o.committed).toBe(false);
  });

  test("missing docs/pm fails every doc check with evidence", async () => {
    const { dir, info } = await webshop();
    await rm(join(dir, "docs", "pm"), { recursive: true });
    await gitCommitAll(dir, "chore: drop docs");
    const ctx = await buildCheckContext(dir, { ...info, epicSlugsBefore: [] }, EMPTY_TELEMETRY);
    expect(ctx.repo).toBeNull();
    const res = await runChecks(commonChecks("spec"), ctx);
    for (const r of res.filter((r) => r.id !== "scoped-diff" && r.id !== "committed")) {
      expect(r.passed).toBe(false);
      expect(r.evidence).toContain("docs/pm");
    }
  });
});
