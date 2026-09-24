import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claim, claimBranch, release, remoteSessionOf } from "../scripts/claim";
import { parseDoc, sessionOf } from "../scripts/contract";
import { fetchOrigin, gitOk, listRemoteBranches, localBranchExists } from "../scripts/git";
import { worktreeFor, worktreePath } from "../scripts/worktree";
import {
  exists,
  fixtureFiles,
  initGitRepo,
  installPreReceiveHook,
  makeTempDir,
  remoteWithClones,
  unclaimedSeed,
  writeTree,
} from "./helpers";

const SLUG = "app-performance";
const EPIC = `docs/pm/${SLUG}/epic.md`;
const OPTS = { harness: "claude-code", takeover: false, staleDays: 14, today: "2026-09-15" };

async function branchOf(dir: string): Promise<string> {
  return (await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], dir)).trim();
}

/** The checkout keeps its branch; the epic's worktree holds pm/<slug>. */
async function expectClaimed(root: string, slug: string, main = "main"): Promise<void> {
  expect(await branchOf(root)).toBe(main);
  expect(await branchOf(worktreePath(root, slug))).toBe(claimBranch(slug));
}

describe("claim", () => {
  test("first claim wins, second is taken", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const first = await claim(a, SLUG, OPTS);
    expect(first.ok).toBe(true);
    await expectClaimed(a, SLUG);
    expect(await listRemoteBranches(a, "pm/")).toEqual(["pm/app-performance"]);
    const epic = parseDoc(EPIC, await readFile(join(worktreePath(a, SLUG), EPIC), "utf8"));
    expect(sessionOf(epic.frontmatter)).toEqual({
      harness: "claude-code",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
    const second = await claim(b, SLUG, { ...OPTS, harness: "pi" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("taken");
      expect(second.owner?.harness).toBe("claude-code");
    }
    expect(await branchOf(b)).toBe("main");
    expect(await worktreeFor(b, claimBranch(SLUG))).toBeNull();
    expect(await remoteSessionOf(b, SLUG)).toEqual({
      harness: "claude-code",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
  });

  test("a fresh claim carries the pending epic out of the main checkout", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const files = await fixtureFiles();
    const epicMd = (files[EPIC] ?? "").replaceAll("app-performance", "brand-new");
    const pending = join(a, "docs", "pm", "brand-new");
    await mkdir(join(pending, "tasks"), { recursive: true });
    await writeFile(join(pending, "epic.md"), epicMd);
    await writeFile(join(a, "app.py"), "print(1)\n");
    const r = await claim(a, "brand-new", OPTS);
    expect(r.ok).toBe(true);
    const wt = worktreePath(a, "brand-new");
    // claim rewrites the session block and updated date; the body is what travelled
    const moved = await readFile(join(wt, "docs", "pm", "brand-new", "epic.md"), "utf8");
    expect(moved).toContain("id: brand-new");
    expect(moved).toContain("harness: claude-code");
    expect(await exists(pending)).toBe(false);
    expect(await readFile(join(a, "app.py"), "utf8")).toBe("print(1)\n");
    expect(await branchOf(a)).toBe("main");
  });

  test("--no-worktree keeps the old checkout-switching behaviour", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const r = await claim(a, SLUG, { ...OPTS, noWorktree: true });
    expect(r.ok).toBe(true);
    expect(await branchOf(a)).toBe(claimBranch(SLUG));
    expect(await worktreeFor(a, claimBranch(SLUG))).not.toBeNull();
  });

  test("simultaneous claims yield exactly one winner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const [ra, rb] = await Promise.all([
      claim(a, SLUG, OPTS),
      claim(b, SLUG, { ...OPTS, harness: "pi" }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect(await listRemoteBranches(a, "pm/")).toEqual(["pm/app-performance"]);
  });

  test("release then claim by another session: branch still marks it taken", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await claim(a, SLUG, OPTS)).ok).toBe(true);
    const rel = await release(a, SLUG, { harness: "claude-code", today: "2026-09-16" });
    expect(rel.ok).toBe(true);
    expect(await remoteSessionOf(b, SLUG)).toBeNull();
    const again = await claim(b, SLUG, { ...OPTS, harness: "pi" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("taken");
  });

  test("takeover allowed only on stale claim and records previous owner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await claim(a, SLUG, { ...OPTS, today: "2026-08-01" })).ok).toBe(true);
    const tooEarly = await claim(b, SLUG, {
      ...OPTS,
      harness: "pi",
      takeover: true,
      today: "2026-08-05",
    });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.reason).toBe("not-stale");
    const late = await claim(b, SLUG, {
      ...OPTS,
      harness: "pi",
      takeover: true,
      today: "2026-09-15",
    });
    expect(late.ok).toBe(true);
    await expectClaimed(b, SLUG);
    const bWt = worktreePath(b, SLUG);
    const epic = await readFile(join(bWt, EPIC), "utf8");
    expect(epic).toContain("harness: pi");
    const plan = await readFile(join(bWt, `docs/pm/${SLUG}/plan.md`), "utf8");
    expect(plan).toContain("taken over from claude-code");
    await fetchOrigin(a);
    expect(await remoteSessionOf(a, SLUG)).toEqual({
      harness: "pi",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
  });

  test("no epic and no remote are reported", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const missing = await claim(a, "nope", OPTS);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("no-epic");
    const lonely = await makeTempDir("lonely");
    await initGitRepo(lonely);
    await writeTree(lonely, await unclaimedSeed());
    const r = await claim(lonely, SLUG, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-remote");
  });

  test("rejected push keeps the local branch and commit (push-failed, not taken)", async () => {
    const { bare, a } = await remoteWithClones(await unclaimedSeed());
    await installPreReceiveHook(bare, 'echo "rejected by policy" >&2; exit 1');
    const r = await claim(a, SLUG, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("push-failed");
      expect(r.message).toContain("git push origin pm/app-performance");
    }
    await expectClaimed(a, SLUG);
    expect(await localBranchExists(a, "pm/app-performance")).toBe(true);
    expect(await gitOk(["log", "-1", "--format=%s"], worktreePath(a, SLUG))).toContain(
      "claim app-performance",
    );
    expect(await listRemoteBranches(a, "pm/")).toEqual([]);
  });

  test("concurrent winner does not delete a pre-existing local branch with unpushed work", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    // B has its own local pm/app-performance with an unpushed commit.
    await gitOk(["checkout", "-q", "-b", "pm/app-performance"], b);
    await writeTree(b, { "docs/pm/app-performance/notes.md": "local work\n" });
    await gitOk(["add", "-A"], b);
    await gitOk(["commit", "-q", "-m", "wip: local notes"], b);
    // A claims first.
    expect((await claim(a, SLUG, OPTS)).ok).toBe(true);
    const r = await claim(b, SLUG, { ...OPTS, harness: "pi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("taken");
    expect(await localBranchExists(b, "pm/app-performance")).toBe(true);
    expect(await gitOk(["log", "--format=%s", "pm/app-performance"], b)).toContain(
      "wip: local notes",
    );
  });

  test("takeover works for an epic that exists only on the remote claim branch", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    // A creates a brand-new epic (not on main) and claims it with an old date.
    const files = await unclaimedSeed();
    const epic = (files[EPIC] ?? "")
      .replaceAll("app-performance", "brand-new")
      .replace("updated: 2026-09-10", "updated: 2026-07-01");
    await writeTree(a, { "docs/pm/brand-new/epic.md": epic });
    expect((await claim(a, "brand-new", { ...OPTS, today: "2026-07-01" })).ok).toBe(true);
    // B is on main and has no docs/pm/brand-new at all.
    expect(await branchOf(b)).toBe("main");
    const r = await claim(b, "brand-new", { ...OPTS, harness: "pi", takeover: true });
    expect(r.ok).toBe(true);
    await expectClaimed(b, "brand-new");
    const taken = await readFile(
      join(worktreePath(b, "brand-new"), "docs/pm/brand-new/epic.md"),
      "utf8",
    );
    expect(taken).toContain("harness: pi");
  });

  test("release writes in the worktree and reports it for the caller to remove", async () => {
    const { a } = await remoteWithClones(await fixtureFiles());
    await claim(a, SLUG, OPTS);
    const wt = worktreePath(a, SLUG);
    const r = await release(a, SLUG, { harness: OPTS.harness, today: OPTS.today });
    expect(r.ok).toBe(true);
    expect(r.worktree).toBe(wt);
    // the session was cleared on the branch, in the worktree
    expect(await readFile(join(wt, EPIC), "utf8")).not.toContain("harness: claude-code");
    expect(await exists(wt)).toBe(true);
  });

  test("release refuses another harness's claim unless forced; unclaimed is reported", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await claim(a, SLUG, OPTS)).ok).toBe(true);
    await fetchOrigin(b);
    await gitOk(["checkout", "-q", "-b", "pm/app-performance", "origin/pm/app-performance"], b);
    const before = await gitOk(["rev-parse", "HEAD"], b);
    const refused = await release(b, SLUG, { harness: "pi", today: "2026-09-16" });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("not-owner");
    expect(refused.message).toContain("owned by claude-code");
    expect(await gitOk(["rev-parse", "HEAD"], b)).toBe(before);
    expect(await remoteSessionOf(b, SLUG)).toEqual({
      harness: "claude-code",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
    const forced = await release(b, SLUG, { harness: "pi", today: "2026-09-16", force: true });
    expect(forced.ok).toBe(true);
    await fetchOrigin(a);
    expect(await remoteSessionOf(a, SLUG)).toBeNull();
    expect(await gitOk(["show", "HEAD", "--stat", "--format=%s"], b)).toContain(
      "release app-performance",
    );
    const plan = await readFile(join(b, `docs/pm/${SLUG}/plan.md`), "utf8");
    expect(plan).toContain("force-released by pi");
    const again = await release(b, SLUG, { harness: "pi", today: "2026-09-17" });
    expect(again.ok).toBe(false);
    expect(again.reason).toBe("unclaimed");
  });
});
