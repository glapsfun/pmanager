import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { preflight } from "../scripts/preflight";
import { writeState } from "../scripts/state";
import { testCtx } from "./ctx";
import { FakeGitHub } from "./fake-github";
import { commitAndPush, commitOnBranch, makeFixture, scratchClone } from "./fixture";

test("a clean fixture passes prepare preflight", async () => {
  const f = await makeFixture();
  expect(await preflight("prepare", testCtx(f))).toEqual([]);
});

test("an origin that is not the configured repo stops at once", async () => {
  const f = await makeFixture();
  const ctx = testCtx(f);
  ctx.cfg = { ...f.cfg, originPattern: /github\.com[:/]acme\/demo$/ };
  expect(await preflight("prepare", ctx)).toEqual([`origin is ${f.bare}, not acme/demo`]);
  expect(ctx.gh.calls).toEqual([]);
});

test("gh missing or logged out is one plain blocker and no further gh calls", async () => {
  class NoGh extends FakeGitHub {
    override async login(): Promise<string> {
      throw new Error("gh: command not found\nmore detail");
    }
  }
  const f = await makeFixture();
  const ctx = testCtx(f, new NoGh(f));
  expect(await preflight("prepare", ctx)).toEqual([
    "gh is not installed or not logged in: gh: command not found",
  ]);
  expect(ctx.gh.calls).toEqual([]);
});

test("a gh account other than the git user names the switch command", async () => {
  const f = await makeFixture();
  const blockers = await preflight("prepare", testCtx(f, new FakeGitHub(f, { login: "bot" })));
  expect(blockers).toEqual([
    "gh is logged in as bot, git user is test: run gh auth switch --user test",
  ]);
});

test("a dirty tree is listed", async () => {
  const f = await makeFixture();
  writeFileSync(join(f.root, "README.md"), "changed\n");
  const [b] = await preflight("prepare", testCtx(f));
  expect(b).toContain("working tree has changes");
  expect(b).toContain(" M README.md");
});

test("manifests that disagree block prepare", async () => {
  const f = await makeFixture();
  const codex = f.cfg.manifests[1] as string;
  const text = readFileSync(join(f.root, codex), "utf8").replace('"0.10.0"', '"0.10.1"');
  await commitAndPush(f, { [codex]: text }, "fix(plugin): drift");
  expect(await preflight("prepare", testCtx(f))).toEqual([
    "manifest versions differ: 0.10.0 vs 0.10.1",
  ]);
});

test("an open release PR or an untagged release branch blocks prepare", async () => {
  const f = await makeFixture();
  await commitOnBranch(f, "release/v0.11.0", { "a.txt": "a\n" }, "chore(release): v0.11.0");
  const gh = new FakeGitHub(f);
  const bodyFile = join(f.root, "..", "b.md");
  writeFileSync(bodyFile, "b\n");
  await gh.createPr("release/v0.11.0", "main", "t", bodyFile);
  const blockers = await preflight("prepare", testCtx(f, gh));
  expect(blockers).toContain(
    "another release is in progress: PR #1 from release/v0.11.0; abandon it first",
  );
  expect(blockers).toContain(
    "another release is in progress: branch release/v0.11.0 on origin; abandon it first",
  );
});

test("a leftover branch of a published release does not block prepare", async () => {
  const f = await makeFixture();
  await commitOnBranch(f, "release/v0.10.0", { "a.txt": "a\n" }, "chore(release): v0.10.0");
  expect(await preflight("prepare", testCtx(f))).toEqual([]);
});

test("an unpublished local candidate blocks prepare", async () => {
  const f = await makeFixture();
  await writeState(f.cfg, {
    schema: 1,
    repo: f.cfg.slug,
    kind: "release",
    version: "0.10.1",
    previousTag: "v0.10.0",
    branch: "release/v0.10.1",
    commit: "c",
    tree: "t",
    phase: "checked",
    blockers: [],
    evidence: [],
    publish: {},
    verify: [],
    updatedAt: "",
  });
  expect(await preflight("prepare", testCtx(f))).toEqual([
    "another release is in progress: v0.10.1 (checked); abandon it first",
  ]);
});

test("publish and baseline need the tag ruleset", async () => {
  const f = await makeFixture();
  const ctx = testCtx(f, new FakeGitHub(f, { tagRuleset: false }));
  const msg = "no active tag ruleset protects v* tags from deletion and update";
  expect(await preflight("publish", ctx)).toEqual([msg]);
  expect(await preflight("baseline", ctx, "0.10.0")).toEqual([msg]);
});

test("baseline refuses when origin already has another release tag", async () => {
  const f = await makeFixture();
  const dir = await scratchClone(f);
  await gitOk(["tag", "-a", "v0.9.0", "-m", "pmanager v0.9.0"], dir);
  await gitOk(["push", "-q", "origin", "refs/tags/v0.9.0"], dir);
  expect(await preflight("baseline", testCtx(f), "0.10.0")).toEqual([
    "origin already has release tags (v0.9.0): baseline is only for the first release",
  ]);
});
