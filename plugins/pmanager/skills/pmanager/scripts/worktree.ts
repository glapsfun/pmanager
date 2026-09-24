import { cp, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { git, localBranchExists, remoteBranchExists } from "./git";
import { PM_DIR } from "./repo";

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

/** Sibling of the repository: /dev/pmanager + app-performance → /dev/pmanager-pm-app-performance */
export function worktreePath(root: string, slug: string): string {
  const clean = root.replace(/\/+$/, "");
  return join(dirname(clean), `${basename(clean)}-pm-${slug}`);
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  let cur: WorktreeEntry | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), branch: null, bare: false, prunable: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "bare") cur.bare = true;
    else if (line.startsWith("prunable")) cur.prunable = true;
  }
  return out;
}

export async function listWorktrees(root: string): Promise<WorktreeEntry[]> {
  const r = await git(["worktree", "list", "--porcelain"], root);
  return r.code === 0 ? parseWorktreeList(r.stdout) : [];
}

/** The worktree holding a branch, skipping registrations whose directory is gone. */
export async function worktreeFor(root: string, branch: string): Promise<WorktreeEntry | null> {
  const entries = await listWorktrees(root);
  return entries.find((w) => w.branch === branch && !w.bare && !w.prunable) ?? null;
}

export type EnsureError = "exists-not-worktree" | "add-failed" | "branch-busy";

export type EnsureResult =
  | { ok: true; path: string; created: boolean }
  | { ok: false; reason: EnsureError; message: string };

export type RemoveResult =
  | { ok: true; removed: boolean }
  | { ok: false; reason: "dirty" | "remove-failed"; message: string };

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function mainCheckout(root: string): Promise<string> {
  const r = await git(["rev-parse", "--show-toplevel"], root);
  return r.code === 0 ? r.stdout.trim() : root;
}

export async function ensureWorktree(
  root: string,
  slug: string,
  opts: { branch: string; startPoint?: string },
): Promise<EnsureResult> {
  const existing = await worktreeFor(root, opts.branch);
  // Covers both a worktree we made earlier and a pre-worktree-era main checkout
  // that is already sitting on the branch.
  if (existing && (await pathExists(existing.path))) {
    return { ok: true, path: existing.path, created: false };
  }
  await git(["worktree", "prune"], root);
  const path = worktreePath(root, slug);
  if (await pathExists(path)) {
    return {
      ok: false,
      reason: "exists-not-worktree",
      message: `${path} exists and is not a worktree for ${opts.branch}; move it aside or pass --no-worktree`,
    };
  }
  const known =
    (await localBranchExists(root, opts.branch)) || (await remoteBranchExists(root, opts.branch));
  const args = known
    ? ["worktree", "add", "-q", path, opts.branch]
    : [
        "worktree",
        "add",
        "-q",
        "-b",
        opts.branch,
        path,
        ...(opts.startPoint ? [opts.startPoint] : []),
      ];
  const r = await git(args, root);
  if (r.code !== 0) {
    const stderr = r.stderr.trim().split("\n")[0] ?? `exit ${r.code}`;
    const busy = /already (checked out|used by)/i.test(r.stderr);
    return {
      ok: false,
      reason: busy ? "branch-busy" : "add-failed",
      message: `git worktree add failed for ${opts.branch}: ${stderr}`,
    };
  }
  return { ok: true, path, created: true };
}

export async function removeWorktree(
  root: string,
  path: string,
  opts: { keep?: boolean },
): Promise<RemoveResult> {
  if (opts.keep) return { ok: true, removed: false };
  // The main checkout is never ours to remove.
  if (path === (await mainCheckout(root))) return { ok: true, removed: false };
  if (!(await pathExists(path))) {
    await git(["worktree", "prune"], root);
    return { ok: true, removed: false };
  }
  const status = await git(["status", "--porcelain", "-uall"], path);
  const dirty = status.stdout.trim();
  if (dirty.length > 0) {
    return {
      ok: false,
      reason: "dirty",
      message: `${path} has uncommitted work:\n${dirty}\ncommit it there, or rerun with --keep-worktree`,
    };
  }
  const r = await git(["worktree", "remove", path], root);
  if (r.code !== 0) {
    return {
      ok: false,
      reason: "remove-failed",
      message: `git worktree remove failed: ${r.stderr.trim().split("\n")[0] ?? `exit ${r.code}`}`,
    };
  }
  return { ok: true, removed: true };
}

async function walkFiles(dir: string, rel: string, out: string[]): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, e.name);
    const childRel = `${rel}/${e.name}`;
    if (e.isDirectory()) await walkFiles(child, childRel, out);
    else out.push(childRel);
  }
}

/** Carry a Phase 4 epic written in the user's checkout onto the claim branch. */
export async function movePendingEpic(root: string, dest: string, slug: string): Promise<string[]> {
  if (dest === root) return [];
  const rel = `${PM_DIR}/${slug}`;
  const from = join(root, rel);
  if (!(await pathExists(from))) return [];
  const files: string[] = [];
  await walkFiles(from, rel, files);
  if (files.length === 0) return [];
  await cp(from, join(dest, rel), { recursive: true });
  await rm(from, { recursive: true, force: true });
  return files.sort();
}
