import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { claimBranch } from "../scripts/claim";
import { listWorktrees, parseWorktreeList, worktreeFor, worktreePath } from "../scripts/worktree";
import { gitOk, initGitRepo, makeTempDir } from "./helpers";

async function realRoot(dir: string): Promise<string> {
  return (await gitOk(["rev-parse", "--show-toplevel"], dir)).trim();
}

describe("worktreePath", () => {
  test("is a sibling of the repo named <repo>-pm-<slug>", () => {
    expect(worktreePath("/home/u/dev/pmanager", "app-performance")).toBe(
      "/home/u/dev/pmanager-pm-app-performance",
    );
  });
  test("ignores a trailing slash on the root", () => {
    expect(worktreePath("/home/u/dev/pmanager/", "x")).toBe("/home/u/dev/pmanager-pm-x");
  });
});

describe("parseWorktreeList", () => {
  test("reads path, branch, bare and prunable", () => {
    const out = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /repo-pm-x",
      "HEAD def",
      "branch refs/heads/pm/x",
      "",
      "worktree /gone",
      "HEAD ghi",
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    expect(parseWorktreeList(out)).toEqual([
      { path: "/repo", branch: "main", bare: false, prunable: false },
      { path: "/repo-pm-x", branch: "pm/x", bare: false, prunable: false },
      { path: "/gone", branch: null, bare: false, prunable: true },
    ]);
  });
  test("reads a bare entry", () => {
    expect(parseWorktreeList("worktree /origin.git\nbare\n\n")).toEqual([
      { path: "/origin.git", branch: null, bare: true, prunable: false },
    ]);
  });
});

describe("listWorktrees + worktreeFor", () => {
  test("finds the worktree holding a branch and ignores a deleted one", async () => {
    const root = await makeTempDir("wt-list");
    await initGitRepo(root);
    const branch = claimBranch("app-performance");
    const wt = worktreePath(root, "app-performance");
    await gitOk(["worktree", "add", "-q", "-b", branch, wt], root);
    expect((await listWorktrees(root)).map((w) => w.branch)).toContain(branch);
    expect((await worktreeFor(root, branch))?.path).toBe(wt);
    await rm(wt, { recursive: true, force: true });
    expect(await worktreeFor(root, branch)).toBeNull();
    expect(await worktreeFor(root, "pm/never")).toBeNull();
  });
  test("the main checkout counts when it holds the branch", async () => {
    const root = await makeTempDir("wt-main");
    await initGitRepo(root);
    await gitOk(["checkout", "-q", "-b", "pm/legacy"], root);
    const found = await worktreeFor(root, "pm/legacy");
    expect(found?.path).toBe(await realRoot(root));
  });
});
