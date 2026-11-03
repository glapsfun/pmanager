import { expect, test } from "bun:test";
import { join } from "node:path";
import { gitOk, makeTempDir } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { FakeGitHub } from "./fake-github";
import { commitAndPush, commitOnBranch, makeFixture } from "./fixture";

const green = (f: { cfg: { requiredChecks: readonly string[] } }) =>
  f.cfg.requiredChecks.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));

async function body(): Promise<string> {
  const file = join(await makeTempDir("body"), "b.md");
  await Bun.write(file, "notes\n");
  return file;
}

test("a PR merges into origin main as a real merge commit", async () => {
  const f = await makeFixture();
  const head = await commitOnBranch(f, "release/v0.10.1", { "a.txt": "a\n" }, "chore: a");
  const gh = new FakeGitHub(f);
  const n = await gh.createPr("release/v0.10.1", "main", "t", await body());
  expect((await gh.prView(n)).mergeStateStatus).toBe("BLOCKED");
  gh.setChecks(n, green(f));
  expect((await gh.prView(n)).mergeStateStatus).toBe("CLEAN");
  await gh.mergePr(n, head);
  const pr = await gh.prView(n);
  expect(pr.state).toBe("MERGED");
  const main = (await gitOk(["rev-parse", "main"], f.bare)).trim();
  expect(pr.mergeCommit).toBe(main);
  expect((await gitOk(["rev-parse", `${main}^2`], f.bare)).trim()).toBe(head);
});

test("a PR is BEHIND once main moves past its base", async () => {
  const f = await makeFixture();
  await commitOnBranch(f, "release/v0.10.1", { "a.txt": "a\n" }, "chore: a");
  const gh = new FakeGitHub(f);
  const n = await gh.createPr("release/v0.10.1", "main", "t", await body());
  gh.setChecks(n, green(f));
  await commitAndPush(f, { "b.txt": "b\n" }, "chore: b");
  expect((await gh.prView(n)).mergeStateStatus).toBe("BEHIND");
});

test("failNext makes one call throw before doing anything", async () => {
  const f = await makeFixture();
  await commitOnBranch(f, "release/v0.10.1", { "a.txt": "a\n" }, "chore: a");
  const gh = new FakeGitHub(f);
  gh.failNext("createPr");
  await expect(gh.createPr("release/v0.10.1", "main", "t", await body())).rejects.toThrow();
  expect(gh.prs).toHaveLength(0);
  expect(await gh.createPr("release/v0.10.1", "main", "t", await body())).toBe(1);
  expect(gh.calls).toEqual(["createPr", "createPr"]);
});

test("a release needs its tag on origin and becomes latest", async () => {
  const f = await makeFixture();
  const gh = new FakeGitHub(f);
  await expect(gh.createRelease("v9.9.9", "v9.9.9", await body())).rejects.toThrow();
  await gh.createRelease("v0.10.0", "v0.10.0", await body());
  expect(await gh.release("v0.10.0")).toMatchObject({ latest: true, body: "notes\n" });
});
