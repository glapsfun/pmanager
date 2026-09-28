import { describe, expect, test } from "bun:test";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { release, remoteEpicOf } from "../scripts/claim";
import { parseDoc, sessionOf } from "../scripts/contract";
import { draftClaim, stubEpic } from "../scripts/draft";
import { fetchOrigin, gitOk, listRemoteBranches, localBranchExists } from "../scripts/git";
import { worktreePath } from "../scripts/worktree";
import {
  exists,
  initGitRepo,
  installPreReceiveHook,
  makeTempDir,
  remoteWithClones,
  unclaimedSeed,
} from "./helpers";

async function holds(root: string): Promise<{ worktree: boolean; branch: boolean }> {
  return {
    worktree: await exists(worktreePath(root, "csv-export")),
    branch: await localBranchExists(root, "pm/csv-export"),
  };
}

async function originTip(root: string): Promise<string> {
  return (
    (await gitOk(["ls-remote", "origin", "refs/heads/pm/csv-export"], root)).split("\t")[0] ?? ""
  );
}

const OPTS = {
  harness: "claude-code",
  today: "2026-09-28",
  title: "CSV export for reports",
  type: "feature",
  distinct: false,
};

describe("stubEpic", () => {
  test("draft frontmatter with the session block; titles are quoted when needed", () => {
    const raw = stubEpic("csv-export", {
      title: "Export: CSV for reports",
      type: "feature",
      today: "2026-09-28",
      session: { harness: "pi", claimed: "2026-09-28", branch: "pm/csv-export" },
    });
    const doc = parseDoc("epic.md", raw);
    expect(doc.frontmatter.title).toBe("Export: CSV for reports");
    expect(doc.frontmatter.status).toBe("draft");
    expect(doc.frontmatter.contract).toBe("1");
    expect(doc.frontmatter.repos).toEqual([]);
    expect(sessionOf(doc.frontmatter)).toEqual({
      harness: "pi",
      claimed: "2026-09-28",
      branch: "pm/csv-export",
    });
    expect(doc.body).toContain("Research in progress; framing happens in Phase 4.");
  });
});

describe("draftClaim", () => {
  test("writes the stub in its own worktree, pushes, and leaves the checkout untouched", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(true);
    const wt = worktreePath(a, "csv-export");
    expect(await readFile(join(wt, "docs/pm/csv-export/epic.md"), "utf8")).toContain(
      "status: draft",
    );
    expect(await exists(join(a, "docs/pm/csv-export"))).toBe(false);
    expect((await gitOk(["status", "--porcelain"], a)).trim()).toBe("");
    expect(await listRemoteBranches(a, "pm/")).toContain("pm/csv-export");
    await fetchOrigin(b);
    expect((await remoteEpicOf(b, "csv-export"))?.status).toBe("draft");
  });

  test("refuses a taken slug, an existing epic, and a look-alike unless --distinct", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await draftClaim(a, "csv-export", OPTS)).ok).toBe(true);
    const taken = await draftClaim(b, "csv-export", { ...OPTS, harness: "pi" });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.reason).toBe("taken");
    const here = await draftClaim(b, "app-performance", { ...OPTS, title: "Something else" });
    expect(here.ok).toBe(false);
    if (!here.ok) expect(here.reason).toBe("exists");
    const alike = await draftClaim(b, "orders-page-slow", {
      ...OPTS,
      title: "Orders page is slow",
      type: "bug",
    });
    expect(alike.ok).toBe(false);
    if (!alike.ok) {
      expect(alike.reason).toBe("look-alike");
      expect(alike.lookAlikes?.map((e) => e.slug)).toEqual(["app-performance"]);
      expect(alike.message).toContain("--distinct");
    }
    const csvAlike = await draftClaim(b, "reports-csv-download", {
      ...OPTS,
      title: "Download reports as CSV",
    });
    expect(csvAlike.ok).toBe(false);
    if (!csvAlike.ok) expect(csvAlike.lookAlikes?.map((e) => e.slug)).toEqual(["csv-export"]);
    const distinct = await draftClaim(b, "reports-csv-download", {
      ...OPTS,
      title: "Download reports as CSV",
      distinct: true,
    });
    expect(distinct.ok).toBe(true);
  });

  test("a local pm/<slug> branch without a remote one is refused", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await gitOk(["branch", "pm/csv-export"], a);
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("taken");
      expect(r.message).toContain("local pm/csv-export branch");
    }
  });

  test("works on a cold start without docs/pm; needs a remote", async () => {
    const { a } = await remoteWithClones({ "README.md": "# app\n" });
    expect((await draftClaim(a, "csv-export", OPTS)).ok).toBe(true);
    const plain = await makeTempDir("draft-plain");
    await initGitRepo(plain);
    const none = await draftClaim(plain, "csv-export", OPTS);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe("no-remote");
  });

  test("simultaneous drafts of one slug yield exactly one winner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const [ra, rb] = await Promise.all([
      draftClaim(a, "csv-export", OPTS),
      draftClaim(b, "csv-export", { ...OPTS, harness: "pi" }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect(await listRemoteBranches(a, "pm/")).toEqual(["pm/csv-export"]);
    const [winner, loser] = ra.ok ? [a, b] : [b, a];
    expect(await holds(winner)).toEqual({ worktree: true, branch: true });
    expect(await holds(loser)).toEqual({ worktree: false, branch: false });
  });

  test("simultaneous drafts in one checkout: one owner, the winner's worktree survives", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const settled = await Promise.allSettled([
      draftClaim(a, "csv-export", OPTS),
      draftClaim(a, "csv-export", { ...OPTS, harness: "pi" }),
    ]);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
    const [ra, rb] = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
    expect([ra?.ok, rb?.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra?.ok ? rb : ra;
    if (loser && !loser.ok) expect(loser.reason).toBe("taken");
    const wt = worktreePath(a, "csv-export");
    const stub = await readFile(join(wt, "docs/pm/csv-export/epic.md"), "utf8");
    expect(stub).toContain(`harness: ${ra?.ok ? "claude-code" : "pi"}`);
    expect(await originTip(a)).toBe((await gitOk(["rev-parse", "HEAD"], wt)).trim());
  });

  test("a failed worktree creation leaves no pm/<slug> branch behind", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await chmod(dirname(a), 0o555);
    const r = await draftClaim(a, "csv-export", OPTS).finally(() => chmod(dirname(a), 0o755));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("worktree");
    expect(await holds(a)).toEqual({ worktree: false, branch: false });
    expect((await draftClaim(a, "csv-export", { ...OPTS, noWorktree: true })).ok).toBe(true);
  });

  test("a sibling path occupied by a file is a worktree refusal that leaves no branch", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await writeFile(worktreePath(a, "csv-export"), "not a worktree\n");
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("worktree");
      expect(r.message).toContain("--no-worktree");
    }
    expect(await localBranchExists(a, "pm/csv-export")).toBe(false);
    expect((await draftClaim(a, "csv-export", { ...OPTS, noWorktree: true })).ok).toBe(true);
  });

  test("an unreachable origin counts as no remote and creates nothing", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await gitOk(["remote", "set-url", "origin", "/nonexistent/x.git"], a);
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no-remote");
      expect(r.message).toBe("origin is unreachable; claims need a reachable shared remote");
    }
    expect(await holds(a)).toEqual({ worktree: false, branch: false });
  });

  test("a --no-worktree checkout failure is reported, not thrown, and leaves no branch", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const lock = join(a, ".git", "HEAD.lock");
    await writeFile(lock, "");
    const r = await draftClaim(a, "csv-export", { ...OPTS, noWorktree: true }).finally(() =>
      rm(lock, { force: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("worktree");
    expect(await holds(a)).toEqual({ worktree: false, branch: false });
    expect((await gitOk(["branch", "--show-current"], a)).trim()).toBe("main");
  });

  test("a failing commit is reported, not thrown, and removes what the draft created", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const hook = join(a, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'blocked by hook' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("worktree");
      expect(r.message).toContain("blocked by hook");
    }
    expect(await holds(a)).toEqual({ worktree: false, branch: false });
    expect(await listRemoteBranches(a, "pm/")).toEqual([]);
  });

  test("a failing commit with --no-worktree restores the checkout and allows a retry", async () => {
    const { a } = await remoteWithClones({ "README.md": "# app\n" });
    const hook = join(a, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o755);
    const r = await draftClaim(a, "csv-export", { ...OPTS, noWorktree: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("worktree");
    expect((await gitOk(["branch", "--show-current"], a)).trim()).toBe("main");
    expect((await gitOk(["status", "--porcelain", "--ignored"], a)).trim()).toBe("");
    expect(await exists(join(a, "docs"))).toBe(false);
    expect(await localBranchExists(a, "pm/csv-export")).toBe(false);
    await rm(hook);
    expect((await draftClaim(a, "csv-export", { ...OPTS, noWorktree: true })).ok).toBe(true);
  });

  test("a push that lands although git reports failure is a success", async () => {
    const { bare, a } = await remoteWithClones(await unclaimedSeed());
    const hook = join(bare, "hooks", "reference-transaction");
    await writeFile(
      hook,
      '#!/bin/sh\n[ "$1" = committed ] || exit 0\nwhile read -r old new ref; do\n  case "$ref" in refs/heads/pm/*) kill -9 "$PPID" ;; esac\ndone\n',
    );
    await chmod(hook, 0o755);
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(true);
    const wt = worktreePath(a, "csv-export");
    expect(await originTip(a)).toBe((await gitOk(["rev-parse", "HEAD"], wt)).trim());
  });

  test("a push rejected by origin keeps the local draft commit and branch", async () => {
    const { bare, a } = await remoteWithClones(await unclaimedSeed());
    await installPreReceiveHook(bare, 'echo "rejected by policy" >&2; exit 1');
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("push-failed");
      expect(r.message).toContain("git push origin pm/csv-export");
    }
    expect(await holds(a)).toEqual({ worktree: true, branch: true });
  });

  test("release --abandon marks the draft abandoned, keeps the branch, frees the idea", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await draftClaim(a, "csv-export", OPTS)).ok).toBe(true);
    const r = await release(a, "csv-export", {
      harness: "claude-code",
      today: "2026-09-29",
      abandon: true,
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("abandoned");
    await fetchOrigin(b);
    const remote = await remoteEpicOf(b, "csv-export");
    expect(remote?.status).toBe("abandoned");
    expect(remote?.session).toBeNull();
    const sameSlug = await draftClaim(b, "csv-export", { ...OPTS, harness: "pi" });
    expect(sameSlug.ok).toBe(false);
    if (!sameSlug.ok) {
      expect(sameSlug.reason).toBe("taken");
      expect(sameSlug.message).toBe(
        "csv-export is already used (status abandoned, branch pm/csv-export); pick another slug",
      );
    }
    const newSlug = await draftClaim(b, "reports-csv-download", {
      ...OPTS,
      harness: "pi",
      title: "Download reports as CSV",
    });
    expect(newSlug.ok).toBe(true);
  });
});
