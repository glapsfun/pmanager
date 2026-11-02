import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { GitError, gitClient } from "../scripts/git";
import { makeFixture } from "./fixture";

test("tree, head and branch read the checkout", async () => {
  const f = await makeFixture();
  const git = gitClient(f.root);
  expect(await git.tree("HEAD")).toBe((await gitOk(["rev-parse", "HEAD^{tree}"], f.root)).trim());
  expect(await git.head()).toBe((await gitOk(["rev-parse", "HEAD"], f.root)).trim());
  expect(await git.branch()).toBe("main");
});

test("out throws GitError carrying git's stderr", async () => {
  const f = await makeFixture();
  const err = await gitClient(f.root)
    .out(["rev-parse", "--verify", "nope^{commit}"])
    .catch((e) => e);
  expect(err).toBeInstanceOf(GitError);
  expect(String(err.message)).toContain("rev-parse --verify nope^{commit}");
  expect(await gitClient(f.root).ok(["rev-parse", "--verify", "nope^{commit}"])).toBe(false);
});

test("dirty keeps porcelain lines intact", async () => {
  const f = await makeFixture();
  writeFileSync(join(f.root, "README.md"), "changed\n");
  expect(await gitClient(f.root).dirty()).toEqual([" M README.md"]);
});

test("remoteTag peels an annotated tag on origin and is null for a missing one", async () => {
  const f = await makeFixture();
  const git = gitClient(f.root);
  expect(await git.remoteTag("v0.10.0")).toBe(await git.head());
  expect(await git.remoteTag("v9.9.9")).toBeNull();
});
