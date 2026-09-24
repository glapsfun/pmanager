import { basename, dirname, join } from "node:path";
import { git } from "./git";

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
