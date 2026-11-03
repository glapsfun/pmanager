import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cmdPrepare } from "../scripts/prepare";
import { readState, writeState } from "../scripts/state";
import { cmdStatus } from "../scripts/status";
import { testCtx } from "./ctx";
import { commitAndPush, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";

test("no state means nothing is in progress", async () => {
  const f = await makeFixture();
  const r = await cmdStatus(testCtx(f));
  expect(r).toMatchObject({ code: 0, phase: "none", next: "run prepare" });
});

test("a prepared candidate reports its phase, reality and next step", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await cmdPrepare(testCtx(f), {});
  const r = await cmdStatus(testCtx(f));
  expect(r.code).toBe(0);
  expect(r.phase).toBe("prepared");
  expect(r.next).toContain("run check");
  expect(r.data?.reality).toMatchObject({
    branch: "release/v0.10.1",
    remoteBranch: null,
    pr: null,
    remoteTag: null,
    release: null,
  });
});

test("a commit after prepare shows as a changed candidate", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await cmdPrepare(testCtx(f), {});
  writeFileSync(join(f.root, "README.md"), "late\n");
  await gitOk(["commit", "-qam", "docs: late"], f.root);
  const r = await cmdStatus(testCtx(f));
  expect(r.code).toBe(1);
  expect(r.blockers).toContain("HEAD tree differs from the prepared candidate");
});

test("a checks process that died is reported", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await cmdPrepare(testCtx(f), {});
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  await writeState(f.cfg, { ...s, checksPid: dead.pid });
  const r = await cmdStatus(testCtx(f));
  expect(r.blockers).toContain(`checks process ${dead.pid} is gone without a result`);
});

test("status flags a release whose verify failed or never ran", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await cmdPrepare(testCtx(f), {});
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const failed = [{ route: "codex" as const, ok: false, detail: "wrong version" }];
  await writeState(f.cfg, { ...s, phase: "published-verify-failed", verify: failed });
  const r = await cmdStatus(testCtx(f));
  expect(r.code).toBe(1);
  expect(r.blockers).toContain("codex: wrong version");
  expect(r.data?.verify).toEqual(failed);
  await writeState(f.cfg, { ...s, phase: "published", verify: [] });
  const unverified = await cmdStatus(testCtx(f));
  expect(unverified.code).toBe(1);
  expect(unverified.blockers).toContain("verify has not run for v0.10.1");
});
