import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { baselineNotes, cmdBaseline } from "../scripts/baseline";
import { main } from "../scripts/release";
import { readState, statePaths } from "../scripts/state";
import { testCtx } from "./ctx";
import { FakeGitHub } from "./fake-github";
import { commitAndPush, commitOnBranch, type Fixture, makeFixture, scratchClone } from "./fixture";

const OK = [{ name: "gate", status: "COMPLETED", conclusion: "SUCCESS" }];

async function untagged(opts: { ruleset?: boolean } = {}) {
  const f = await makeFixture({ tagged: false });
  const head = (await gitOk(["rev-parse", "HEAD"], f.root)).trim();
  const gh = new FakeGitHub(f, { tagRuleset: opts.ruleset ?? true });
  gh.setCommitChecks(head, OK);
  return { f, gh, ctx: testCtx(f, gh), head };
}

const tagged = async (f: Fixture, tag: string) =>
  (await gitOk(["ls-remote", "origin", `refs/tags/${tag}^{}`], f.root)).split("\t")[0];

test("baselineNotes names the PR when the commit merged one", () => {
  expect(
    baselineNotes(
      "0.10.0",
      "Merge pull request #20 from glapsfun/feat/planning-traps",
      "9520e6b0000",
    ),
  ).toBe(
    "Baseline release: pmanager 0.10.0 as merged in #20. Earlier versions were not tagged. Later releases list their changes against this tag.\n",
  );
  expect(baselineNotes("0.10.0", "feat: initial", "9520e6b0000")).toBe(
    "Baseline release: pmanager 0.10.0 as of 9520e6b. Earlier versions were not tagged. Later releases list their changes against this tag.\n",
  );
});

test("baseline tags the commit, releases it and verifies", async () => {
  const { f, gh, ctx, head } = await untagged();
  const r = await cmdBaseline(ctx, { commit: head.slice(0, 7) });
  expect(r).toMatchObject({ code: 0, phase: "published" });
  expect(await tagged(f, "v0.10.0")).toBe(head);
  expect((await gitOk(["cat-file", "-t", "refs/tags/v0.10.0"], f.bare)).trim()).toBe("tag");
  expect(gh.releases.map((x) => [x.tagName, x.latest])).toEqual([["v0.10.0", true]]);
  expect(gh.releases[0]?.body).toBe(readFileSync(statePaths(f.cfg).notes, "utf8"));
  expect(await readState(f.cfg)).toMatchObject({
    kind: "baseline",
    version: "0.10.0",
    commit: head,
  });
});

test("an interrupted baseline resumes to one tag and one release", async () => {
  const { gh, ctx, head } = await untagged();
  gh.failNext("createRelease");
  await expect(cmdBaseline(ctx, { commit: head })).rejects.toThrow();
  expect((await cmdBaseline(ctx, { commit: head })).code).toBe(0);
  expect(gh.releases).toHaveLength(1);
});

test("baseline refuses a repo that already has release tags", async () => {
  const { f, ctx, head } = await untagged();
  const dir = await scratchClone(f);
  await gitOk(["tag", "-a", "v0.9.0", "-m", "x"], dir);
  await gitOk(["push", "-q", "origin", "refs/tags/v0.9.0"], dir);
  const r = await cmdBaseline(ctx, { commit: head });
  expect(r.code).toBe(1);
  expect(r.blockers?.[0]).toContain("origin already has release tags (v0.9.0)");
});

test("baseline refuses failing or missing CI on the commit", async () => {
  const { gh, ctx, head } = await untagged();
  gh.setCommitChecks(head, [
    ...OK,
    { name: "bench-gate", status: "COMPLETED", conclusion: "FAILURE" },
  ]);
  const r = await cmdBaseline(ctx, { commit: head });
  expect(r.code).toBe(1);
  expect(r.blockers).toEqual([`CI check bench-gate is FAILURE on ${head.slice(0, 7)}`]);
  gh.setCommitChecks(head, []);
  expect((await cmdBaseline(ctx, { commit: head })).message).toBe(
    `no CI results recorded for ${head.slice(0, 7)}`,
  );
});

test("baseline refuses manifests that disagree at the commit", async () => {
  const { f, gh, ctx } = await untagged();
  const codex = f.cfg.manifests[1] as string;
  const text = readFileSync(join(f.root, codex), "utf8").replace('"0.10.0"', '"0.10.1"');
  const drift = await commitAndPush(f, { [codex]: text }, "fix(plugin): drift");
  gh.setCommitChecks(drift, OK);
  const r = await cmdBaseline(ctx, { commit: drift });
  expect(r.code).toBe(1);
  expect(r.message).toBe(`manifest versions differ at ${drift.slice(0, 7)}: 0.10.0 vs 0.10.1`);
});

test("baseline refuses a commit that is not on main", async () => {
  const { f, gh, ctx } = await untagged();
  const side = await commitOnBranch(f, "side", { "a.txt": "a\n" }, "chore: side");
  await gitOk(["fetch", "-q", "origin"], f.root);
  gh.setCommitChecks(side, OK);
  const r = await cmdBaseline(ctx, { commit: side });
  expect(r.code).toBe(1);
  expect(r.message).toBe(`${side.slice(0, 7)} is not on origin/main`);
});

test("baseline refuses without the tag ruleset", async () => {
  const { ctx, head } = await untagged({ ruleset: false });
  const r = await cmdBaseline(ctx, { commit: head });
  expect(r.code).toBe(1);
  expect(r.blockers).toEqual(["no active tag ruleset protects v* tags from deletion and update"]);
});

test("the CLI needs --commit for baseline", async () => {
  const { ctx } = await untagged();
  expect(await main(["baseline"], { ...ctx, out: () => {} })).toBe(2);
});
