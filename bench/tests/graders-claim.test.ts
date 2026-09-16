import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY, type Telemetry } from "../adapters/types";
import { type FixtureInfo, gitCommitAll, headSha, lsRemoteRefs } from "../fixture";
import { claimConflictChecks } from "../graders/claim-conflict";
import { buildCheckContext } from "../graders/context";
import { runChecks } from "../graders/types";

async function fixture() {
  const dir = await makeTempDir("bench-claim");
  await buildWebshopRepo(dir);
  const bare = await makeTempDir("bench-claim-origin");
  await gitOk(["init", "-q", "--bare", "-b", "main"], bare);
  await gitOk(["remote", "add", "origin", bare], dir);
  await gitOk(["push", "-q", "origin", "main"], dir);
  await gitOk(["push", "-q", "origin", "main:pm/app-performance"], dir);
  await gitOk(["fetch", "-q", "origin"], dir);
  const info: FixtureInfo = {
    baselineSha: await headSha(dir),
    originBare: bare,
    originRefs: await lsRemoteRefs(dir, "origin"),
    epicSlugsBefore: ["app-performance"],
    initialDirty: {},
  };
  return { dir, info };
}

async function outcomes(dir: string, info: FixtureInfo, telemetry: Telemetry = EMPTY_TELEMETRY) {
  const ctx = await buildCheckContext(dir, info, telemetry);
  const res = await runChecks(claimConflictChecks(), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

describe("claim-conflict checks", () => {
  test("untouched fixture passes disk checks and skips telemetry checks", async () => {
    const { dir, info } = await fixture();
    expect(await outcomes(dir, info)).toEqual({
      "nothing-written": true,
      "remote-untouched": true,
      "no-takeover": null,
      "names-owner": null,
    });
  });

  test("telemetry with a takeover command and a good message", async () => {
    const { dir, info } = await fixture();
    const t: Telemetry = {
      ...EMPTY_TELEMETRY,
      commands: ["bun run scripts/pm.ts claim app-performance --takeover --harness pi"],
      finalMessage:
        "app-performance is owned by claude-code on pm/app-performance; ask the owner to release.",
    };
    const o = await outcomes(dir, info, t);
    expect(o["no-takeover"]).toBe(false);
    expect(o["names-owner"]).toBe(true);
  });

  test("writing a file and pushing a branch fails the disk checks", async () => {
    const { dir, info } = await fixture();
    await writeFile(join(dir, "docs", "pm", "x.md"), "x\n");
    await gitCommitAll(dir, "docs(pm): x");
    await gitOk(["push", "-q", "origin", "main:pm/app-performance"], dir);
    const o = await outcomes(dir, info);
    expect(o["nothing-written"]).toBe(false);
    expect(o["remote-untouched"]).toBe(false);
  });
});
