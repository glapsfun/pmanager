import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { git, gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cmdAbandon } from "../scripts/abandon";
import { cmdPrepare } from "../scripts/prepare";
import { statePaths } from "../scripts/state";
import { testCtx } from "./ctx";
import { commitAndPush, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";

async function prepared() {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  const ctx = testCtx(f);
  await cmdPrepare(ctx, {});
  return { f, ctx };
}

const hasBranch = async (dir: string, ref: string) =>
  (await git(["rev-parse", "--verify", "--quiet", ref], dir)).code === 0;

test("abandon drops a local candidate and its state", async () => {
  const { f, ctx } = await prepared();
  const r = await cmdAbandon(ctx);
  expect(r).toMatchObject({ code: 0, phase: "none" });
  expect((await gitOk(["branch", "--show-current"], f.root)).trim()).toBe("main");
  expect(await hasBranch(f.root, "refs/heads/release/v0.10.1")).toBe(false);
  expect(existsSync(statePaths(f.cfg).state)).toBe(false);
});

test("abandon closes an open release PR and deletes the remote branch", async () => {
  const { f, ctx } = await prepared();
  await gitOk(["push", "-q", "origin", "release/v0.10.1"], f.root);
  const body = join(f.root, "..", "b.md");
  await Bun.write(body, "b\n");
  await ctx.gh.createPr("release/v0.10.1", "main", "t", body);
  expect((await cmdAbandon(ctx)).code).toBe(0);
  expect(ctx.gh.prs[0]?.state).toBe("CLOSED");
  expect(ctx.gh.comments.get(1)).toBe("Abandoned by release-guru.");
  expect(await hasBranch(f.bare, "refs/heads/release/v0.10.1")).toBe(false);
});

test("abandon deletes a pushed branch that has no PR", async () => {
  const { f, ctx } = await prepared();
  await gitOk(["push", "-q", "origin", "release/v0.10.1"], f.root);
  expect((await cmdAbandon(ctx)).code).toBe(0);
  expect(await hasBranch(f.bare, "refs/heads/release/v0.10.1")).toBe(false);
});

test("abandon refuses a published version", async () => {
  const { f, ctx } = await prepared();
  await gitOk(["tag", "-a", "v0.10.1", "-m", "x"], f.root);
  await gitOk(["push", "-q", "origin", "refs/tags/v0.10.1"], f.root);
  const r = await cmdAbandon(ctx);
  expect(r.code).toBe(1);
  expect(r.message).toBe("v0.10.1 is already published; a correction is a new patch release");
  expect(existsSync(statePaths(f.cfg).state)).toBe(true);
});

test("abandon refuses once the release PR was merged", async () => {
  const { f, ctx } = await prepared();
  await gitOk(["push", "-q", "origin", "release/v0.10.1"], f.root);
  const body = join(f.root, "..", "b.md");
  await Bun.write(body, "b\n");
  const n = await ctx.gh.createPr("release/v0.10.1", "main", "t", body);
  ctx.gh.setChecks(
    n,
    f.cfg.requiredChecks.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" })),
  );
  await ctx.gh.mergePr(n, (await gitOk(["rev-parse", "HEAD"], f.root)).trim());
  const r = await cmdAbandon(ctx);
  expect(r.code).toBe(1);
  expect(r.message).toBe("the release PR #1 was merged; finish with publish instead");
});
