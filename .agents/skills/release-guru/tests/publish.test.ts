import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  gitOk,
  installPreReceiveHook,
} from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cmdPrepare } from "../scripts/prepare";
import { cmdPublish } from "../scripts/publish";
import { main } from "../scripts/release";
import { acquireLock, readState, releaseLock, statePaths, writeState } from "../scripts/state";
import { testCtx } from "./ctx";
import { FakeGitHub } from "./fake-github";
import { commitAndPush, commitOnBranch, type Fixture, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";

const green = (f: Fixture) =>
  f.cfg.requiredChecks.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));

/** A prepared candidate with passing evidence for its tree, ready for publish. */
async function checked(opts: { evidence?: boolean } = {}) {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  const gh = new FakeGitHub(f);
  const ctx = testCtx(f, gh);
  await cmdPrepare(ctx, {});
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const ev = (check: "gate" | "agents") => ({
    check,
    command: ["x"],
    commit: s.commit,
    tree: s.tree,
    tools: {},
    result: "pass" as const,
    detail: "",
    startedAt: "2026-11-02T10:00:00Z",
    finishedAt: "2026-11-02T10:05:00Z",
  });
  await writeState(f.cfg, {
    ...s,
    phase: "checked",
    evidence: opts.evidence === false ? [] : [ev("gate"), ev("agents")],
  });
  return { f, gh, ctx, tree: s.tree, commit: s.commit };
}

const onOrigin = async (f: Fixture, ref: string) =>
  (await gitOk(["rev-parse", ref], f.bare)).trim();

test("publish pushes, opens the PR, waits for CI, merges, tags and releases", async () => {
  const { f, gh, ctx, tree, commit } = await checked();
  const first = await cmdPublish(ctx, { tree, wait: 0 });
  expect(first).toMatchObject({ code: 3, phase: "publishing" });
  expect(first.next).toBe(`rerun publish --tree ${tree}`);
  expect(await onOrigin(f, "refs/heads/release/v0.10.1")).toBe(commit);
  expect(gh.prs).toHaveLength(1);
  const body = gh.bodies.get(1) ?? "";
  expect(body).toContain("- a fix (");
  expect(body).toContain("## Release checks");
  gh.setChecks(1, green(f));
  const second = await cmdPublish(ctx, { tree, wait: 0 });
  expect(second).toMatchObject({ code: 0, phase: "published" });
  const merge = await onOrigin(f, "refs/heads/main");
  expect((await gitOk(["rev-parse", `${merge}^2`], f.bare)).trim()).toBe(commit);
  expect(await ctx.git.remoteTag("v0.10.1")).toBe(merge);
  expect((await gitOk(["cat-file", "-t", "refs/tags/v0.10.1"], f.bare)).trim()).toBe("tag");
  expect(gh.releases.map((r) => [r.tagName, r.latest])).toEqual([["v0.10.1", true]]);
  expect((await readState(f.cfg))?.publish).toMatchObject({
    mergeCommit: merge,
    tagged: true,
    released: true,
  });
});

test("publish refuses without passing evidence, a matching tree, clean notes or the tag ruleset", async () => {
  const cases: [
    string,
    (c: Awaited<ReturnType<typeof checked>>) => Promise<{ tree: string; gh?: FakeGitHub }>,
  ][] = [
    ["no evidence", async (c) => ({ tree: c.tree })],
    ["another tree", async () => ({ tree: "0000000000000000000000000000000000000000" })],
    [
      "TODO in notes",
      async (c) => {
        writeFileSync(statePaths(c.f.cfg).notes, "## Fixed\n\n- TODO (#1)\n");
        return { tree: c.tree };
      },
    ],
    ["no ruleset", async (c) => ({ tree: c.tree, gh: new FakeGitHub(c.f, { tagRuleset: false }) })],
  ];
  for (const [name, arrange] of cases) {
    const c = await checked({ evidence: name !== "no evidence" });
    const { tree, gh } = await arrange(c);
    const ctx = gh ? testCtx(c.f, gh) : c.ctx;
    const r = await cmdPublish(ctx, { tree, wait: 0 });
    expect(r.code, name).toBe(1);
    expect(ctx.gh.calls.includes("createPr"), name).toBe(false);
  }
});

test("each interruption resumes to exactly one PR, merge, tag and release", async () => {
  for (const step of ["createPr", "mergePr", "createRelease", "tag push"] as const) {
    const { f, gh, ctx, tree } = await checked();
    gh.setChecks(1, green(f));
    if (step === "tag push") {
      const marker = join(f.root, "..", "rejected-once");
      await installPreReceiveHook(
        f.bare,
        `while read old new ref; do case "$ref" in refs/tags/*) if [ ! -f ${marker} ]; then touch ${marker}; echo rejected >&2; exit 1; fi;; esac; done`,
      );
    } else {
      gh.failNext(step);
    }
    await expect(cmdPublish(ctx, { tree, wait: 0 }), step).rejects.toThrow();
    gh.setChecks(1, green(f));
    const r = await cmdPublish(ctx, { tree, wait: 0 });
    expect(r.code, step).toBe(0);
    expect(gh.prs, step).toHaveLength(1);
    expect(gh.releases, step).toHaveLength(1);
    expect((await gitOk(["rev-list", "--merges", "--count", "main"], f.bare)).trim(), step).toBe(
      "1",
    );
  }
});

test("main moving after the checks stops before merging", async () => {
  const { f, gh, ctx, tree } = await checked();
  await cmdPublish(ctx, { tree, wait: 0 });
  gh.setChecks(1, green(f));
  await commitAndPush(f, { "README.md": "moved\n" }, "docs: moved");
  const r = await cmdPublish(ctx, { tree, wait: 0 });
  expect(r.code).toBe(1);
  expect(r.message).toBe("main moved since the checks; abandon and prepare again");
  expect(gh.calls).not.toContain("mergePr");
});

test("a failing PR check stops before merging and names it", async () => {
  const { f, gh, ctx, tree } = await checked();
  await cmdPublish(ctx, { tree, wait: 0 });
  gh.setChecks(
    1,
    green(f).map((c) => (c.name === "test" ? { ...c, conclusion: "FAILURE" } : c)),
  );
  const r = await cmdPublish(ctx, { tree, wait: 0 });
  expect(r.code).toBe(1);
  expect(r.blockers).toEqual(["PR check failed: test"]);
  expect(gh.calls).not.toContain("mergePr");
});

test("GitHub blocking a green PR is reported, not forced", async () => {
  const { f, gh, ctx, tree } = await checked();
  await cmdPublish(ctx, { tree, wait: 0 });
  gh.setChecks(1, green(f));
  gh.mergeStateOverride = "BLOCKED";
  const r = await cmdPublish(ctx, { tree, wait: 0 });
  expect(r.code).toBe(1);
  expect(r.message).toBe(`GitHub blocks the merge although checks passed: ${gh.prs[0]?.url}`);
});

test("a merge commit whose tree differs is never tagged", async () => {
  const { f, gh, ctx, tree } = await checked();
  gh.setChecks(1, green(f));
  gh.mergeExtra = { "extra.txt": "x\n" };
  const r = await cmdPublish(ctx, { tree, wait: 0 });
  expect(r.code).toBe(1);
  expect(r.message).toBe(
    "the merge commit's tree differs from the checked tree; nothing was tagged",
  );
  expect(r.next).toBe(
    "run abandon; main now carries the bump, so the next prepare needs --version above 0.10.1",
  );
  expect(await ctx.git.remoteTag("v0.10.1")).toBeNull();
});

test("a v0.10.1 tag pushed elsewhere first stops publish before anything is pushed", async () => {
  const { f, gh, ctx, tree } = await checked();
  const other = await commitOnBranch(f, "side", { "a.txt": "a\n" }, "chore: side");
  await gitOk(["tag", "-a", "v0.10.1", "-m", "x", other], f.bare);
  const r = await cmdPublish(ctx, { tree, wait: 0 });
  expect(r.code).toBe(1);
  expect(r.message).toBe(`v0.10.1 already exists on ${other}`);
  expect(r.next).toBe("run abandon; the next prepare needs --version above 0.10.1");
  expect(gh.calls).not.toContain("createPr");
  expect(gh.calls).not.toContain("createRelease");
});

test("a finished release reruns without new writes; a different release stops it", async () => {
  const { f, gh, ctx, tree } = await checked();
  gh.setChecks(1, green(f));
  expect((await cmdPublish(ctx, { tree, wait: 0 })).code).toBe(0);
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  await writeState(f.cfg, {
    ...s,
    phase: "publishing",
    publish: { ...s.publish, released: false },
  });
  gh.calls.length = 0;
  expect((await cmdPublish(ctx, { tree, wait: 0 })).code).toBe(0);
  expect(gh.calls).not.toContain("createRelease");
  expect(gh.releases).toHaveLength(1);
  (gh.releases[0] as { draft: boolean }).draft = true;
  await writeState(f.cfg, {
    ...s,
    phase: "publishing",
    publish: { ...s.publish, released: false },
  });
  const r = await cmdPublish(ctx, { tree, wait: 0 });
  expect(r.code).toBe(1);
  expect(r.message).toBe(`a different release exists for v0.10.1: ${gh.releases[0]?.url}`);
});

test("a held lock blocks publish", async () => {
  const { f, ctx, tree } = await checked();
  const sleeper = Bun.spawn(["sleep", "30"]);
  try {
    await acquireLock(f.cfg, "prepare", sleeper.pid);
    expect(await main(["publish", "--tree", tree], { ...ctx, out: () => {} })).toBe(1);
  } finally {
    sleeper.kill();
    await releaseLock(f.cfg);
  }
});

test("a rerun never reports a release whose verify failed or never ran as done", async () => {
  const { f, gh, ctx, tree } = await checked();
  gh.setChecks(1, green(f));
  let calls = 0;
  const failing = async () => ({ route: "codex" as const, ok: false, detail: "wrong version" });
  const passing = async () => {
    calls++;
    return { route: "github" as const, ok: true, detail: "ok" };
  };
  const first = await cmdPublish({ ...ctx, routes: [failing] }, { tree, wait: 0 });
  expect(first).toMatchObject({ code: 1, phase: "published-verify-failed" });
  const rerun = await cmdPublish({ ...ctx, routes: [failing] }, { tree, wait: 0 });
  expect(rerun).toMatchObject({ code: 1, phase: "published-verify-failed" });
  expect(rerun.blockers).toEqual(["codex: wrong version"]);
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  await writeState(f.cfg, { ...s, phase: "published", verify: [] });
  const resumed = await cmdPublish({ ...ctx, routes: [passing] }, { tree, wait: 0 });
  expect(resumed).toMatchObject({ code: 0, phase: "published" });
  expect(calls).toBe(1);
});
