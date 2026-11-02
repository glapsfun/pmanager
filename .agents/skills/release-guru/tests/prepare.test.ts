import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { REPO_ROOT } from "../scripts/config";
import { bumpManifest, cmdPrepare } from "../scripts/prepare";
import { readState, statePaths } from "../scripts/state";
import { testCtx } from "./ctx";
import { commitAndPush, commitOnBranch, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";
const version = (root: string, m: string) =>
  (JSON.parse(readFileSync(join(root, m), "utf8")) as { version: string }).version;

test("prepare makes the release branch, bumps both manifests and drafts notes, pushing nothing", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  const r = await cmdPrepare(testCtx(f), {});
  expect(r.code).toBe(0);
  expect(r.data?.version).toBe("0.10.1");
  expect((await gitOk(["branch", "--show-current"], f.root)).trim()).toBe("release/v0.10.1");
  expect((await gitOk(["log", "-1", "--format=%s"], f.root)).trim()).toBe(
    "chore(release): v0.10.1",
  );
  for (const m of f.cfg.manifests) expect(version(f.root, m)).toBe("0.10.1");
  expect((await gitOk(["ls-remote", "origin", "release/v0.10.1"], f.root)).trim()).toBe("");
  const s = await readState(f.cfg);
  expect(s?.phase).toBe("prepared");
  expect(s?.tree).toBe((await gitOk(["rev-parse", "HEAD^{tree}"], f.root)).trim());
  expect(s?.previousTag).toBe("v0.10.0");
  expect(readFileSync(statePaths(f.cfg).notes, "utf8")).toMatch(/- a fix \([0-9a-f]{7}\)/);
});

test("bumpManifest changes only the top-level version value", () => {
  for (const m of [
    "plugins/pmanager/.claude-plugin/plugin.json",
    "plugins/pmanager/.codex-plugin/plugin.json",
  ]) {
    const text = readFileSync(join(REPO_ROOT, m), "utf8");
    const old = (JSON.parse(text) as { version: string }).version;
    const bumped = bumpManifest(text, "9.8.7");
    expect((JSON.parse(bumped) as { version: string }).version).toBe("9.8.7");
    expect(bumped.replace('"version": "9.8.7"', `"version": "${old}"`)).toBe(text);
  }
  expect(() => bumpManifest('{\n  "a": {\n    "version": "1.0.0"\n  }\n}\n', "2.0.0")).toThrow();
});

test("a feature proposes a minor bump and --version overrides it", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "feat(pm): a feature");
  expect((await cmdPrepare(testCtx(f), {})).data?.version).toBe("0.11.0");
  const g = await makeFixture();
  await commitAndPush(g, { [SKILL]: "x\n" }, "fix(pm): a fix");
  expect((await cmdPrepare(testCtx(g), { version: "0.12.0" })).data?.version).toBe("0.12.0");
});

test("a --version that is not newer, or is a prerelease, is a usage error", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  expect((await cmdPrepare(testCtx(f), { version: "0.10.0" })).code).toBe(2);
  expect((await cmdPrepare(testCtx(f), { version: "0.11.0-rc.1" })).code).toBe(2);
  expect((await gitOk(["branch", "--show-current"], f.root)).trim()).toBe("main");
});

test("nothing shipped since the last tag means nothing to release", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { "README.md": "more\n" }, "docs: readme");
  const r = await cmdPrepare(testCtx(f), {});
  expect(r.code).toBe(1);
  expect(r.message).toBe("nothing to release since v0.10.0");
  expect((await gitOk(["branch", "--show-current"], f.root)).trim()).toBe("main");
});

test("a dirty checkout is refused and left as it was", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  writeFileSync(join(f.root, "README.md"), "mine\n");
  const r = await cmdPrepare(testCtx(f), {});
  expect(r.code).toBe(1);
  expect(r.blockers?.[0]).toContain("working tree has changes");
  expect(readFileSync(join(f.root, "README.md"), "utf8")).toBe("mine\n");
  expect((await gitOk(["branch", "--show-current"], f.root)).trim()).toBe("main");
});

test("with no release tag yet prepare asks for the baseline", async () => {
  const f = await makeFixture({ tagged: false });
  const r = await cmdPrepare(testCtx(f), {});
  expect(r.code).toBe(1);
  expect(r.message).toBe("no release tag yet: run baseline first");
});

test("a version already tagged on origin off main is refused", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  const side = await commitOnBranch(f, "side", { "a.txt": "a\n" }, "chore: side");
  await gitOk(["fetch", "-q", "origin"], f.root);
  await gitOk(["tag", "-a", "v0.10.1", "-m", "x", side], f.root);
  await gitOk(["push", "-q", "origin", "refs/tags/v0.10.1"], f.root);
  const r = await cmdPrepare(testCtx(f), {});
  expect(r.code).toBe(1);
  expect(r.message).toBe("v0.10.1 already exists on origin");
  expect((await git(["rev-parse", "--verify", "release/v0.10.1"], f.root)).code).not.toBe(0);
});
