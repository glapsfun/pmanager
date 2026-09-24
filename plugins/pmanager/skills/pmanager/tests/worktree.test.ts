import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claimBranch } from "../scripts/claim";
import {
  ensureWorktree,
  listWorktrees,
  movePendingEpic,
  parseWorktreeList,
  removeWorktree,
  worktreeFor,
  worktreePath,
} from "../scripts/worktree";
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

async function repoWithCommit(prefix: string): Promise<string> {
  const root = await makeTempDir(prefix);
  await initGitRepo(root);
  return root;
}

describe("ensureWorktree", () => {
  test("creates a new worktree on a new branch", async () => {
    const root = await repoWithCommit("wt-create");
    const r = await ensureWorktree(root, "app-performance", { branch: "pm/app-performance" });
    expect(r).toEqual({ ok: true, path: worktreePath(root, "app-performance"), created: true });
    expect((await worktreeFor(root, "pm/app-performance"))?.path).toBe(
      worktreePath(root, "app-performance"),
    );
  });
  test("reuses an existing worktree without recreating it", async () => {
    const root = await repoWithCommit("wt-reuse");
    await ensureWorktree(root, "x", { branch: "pm/x" });
    const again = await ensureWorktree(root, "x", { branch: "pm/x" });
    expect(again).toEqual({ ok: true, path: worktreePath(root, "x"), created: false });
  });
  test("recreates after the directory was deleted behind git's back", async () => {
    const root = await repoWithCommit("wt-stale");
    const first = await ensureWorktree(root, "x", { branch: "pm/x" });
    if (!first.ok) throw new Error(first.message);
    await rm(first.path, { recursive: true, force: true });
    const again = await ensureWorktree(root, "x", { branch: "pm/x" });
    expect(again).toEqual({ ok: true, path: worktreePath(root, "x"), created: true });
  });
  test("the main checkout already on the branch is a usable target", async () => {
    const root = await repoWithCommit("wt-legacy");
    await gitOk(["checkout", "-q", "-b", "pm/legacy"], root);
    const r = await ensureWorktree(root, "legacy", { branch: "pm/legacy" });
    expect(r).toEqual({ ok: true, path: await realRoot(root), created: false });
  });
  test("an occupied path that is not our worktree is an error", async () => {
    const root = await repoWithCommit("wt-occupied");
    const path = worktreePath(root, "x");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "keep.txt"), "mine\n");
    const r = await ensureWorktree(root, "x", { branch: "pm/x" });
    expect(r).toEqual({
      ok: false,
      reason: "exists-not-worktree",
      message: `${path} exists and is not a worktree for pm/x; move it aside or pass --no-worktree`,
    });
  });
});

describe("removeWorktree", () => {
  test("removes a clean worktree", async () => {
    const root = await repoWithCommit("wt-rm");
    const path = worktreePath(root, "x");
    await ensureWorktree(root, "x", { branch: "pm/x" });
    expect(await removeWorktree(root, path, {})).toEqual({ ok: true, removed: true });
    expect(await worktreeFor(root, "pm/x")).toBeNull();
  });
  test("refuses a dirty worktree and names the files", async () => {
    const root = await repoWithCommit("wt-dirty");
    const path = worktreePath(root, "x");
    await ensureWorktree(root, "x", { branch: "pm/x" });
    await writeFile(join(path, "scratch.md"), "unsaved\n");
    const r = await removeWorktree(root, path, {});
    expect(r.ok).toBe(false);
    expect("message" in r && r.message).toContain("scratch.md");
    expect(await worktreeFor(root, "pm/x")).not.toBeNull();
  });
  test("keep skips removal entirely", async () => {
    const root = await repoWithCommit("wt-keep");
    const path = worktreePath(root, "x");
    await ensureWorktree(root, "x", { branch: "pm/x" });
    expect(await removeWorktree(root, path, { keep: true })).toEqual({ ok: true, removed: false });
    expect(await worktreeFor(root, "pm/x")).not.toBeNull();
  });
  test("removing the main checkout is a no-op, not a failure", async () => {
    const root = await repoWithCommit("wt-main-rm");
    await gitOk(["checkout", "-q", "-b", "pm/legacy"], root);
    expect(await removeWorktree(root, await realRoot(root), {})).toEqual({
      ok: true,
      removed: false,
    });
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("movePendingEpic", () => {
  test("moves the epic dir, leaves other dirty files, reports the paths", async () => {
    const root = await repoWithCommit("wt-move");
    await mkdir(join(root, "docs", "pm", "x", "tasks"), { recursive: true });
    await writeFile(join(root, "docs", "pm", "x", "epic.md"), "# epic\n");
    await writeFile(join(root, "docs", "pm", "x", "tasks", "T01-a.md"), "# T01\n");
    await writeFile(join(root, "app.py"), "print(1)\n");
    const dest = worktreePath(root, "x");
    await ensureWorktree(root, "x", { branch: "pm/x" });
    const moved = await movePendingEpic(root, dest, "x");
    expect(moved).toEqual(["docs/pm/x/epic.md", "docs/pm/x/tasks/T01-a.md"]);
    expect(await readFile(join(dest, "docs", "pm", "x", "epic.md"), "utf8")).toBe("# epic\n");
    expect(await exists(join(root, "docs", "pm", "x"))).toBe(false);
    expect(await readFile(join(root, "app.py"), "utf8")).toBe("print(1)\n");
  });
  test("no epic dir means nothing to move", async () => {
    const root = await repoWithCommit("wt-move-none");
    const dest = worktreePath(root, "x");
    await ensureWorktree(root, "x", { branch: "pm/x" });
    expect(await movePendingEpic(root, dest, "x")).toEqual([]);
  });
  test("a destination equal to the source is a no-op", async () => {
    const root = await repoWithCommit("wt-move-same");
    await mkdir(join(root, "docs", "pm", "x"), { recursive: true });
    await writeFile(join(root, "docs", "pm", "x", "epic.md"), "# epic\n");
    expect(await movePendingEpic(root, root, "x")).toEqual([]);
    expect(await readFile(join(root, "docs", "pm", "x", "epic.md"), "utf8")).toBe("# epic\n");
  });
});
