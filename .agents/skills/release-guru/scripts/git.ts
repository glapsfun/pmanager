import { capture } from "../../../../ci/proc";

export type Run = (
  cmd: string[],
  cwd: string,
  env?: Record<string, string>,
  inherit?: boolean,
  timeoutMs?: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export class GitError extends Error {}

export interface Git {
  out(args: string[]): Promise<string>;
  ok(args: string[]): Promise<boolean>;
  tree(rev: string): Promise<string>;
  head(): Promise<string>;
  branch(): Promise<string>;
  dirty(): Promise<string[]>;
  remoteTag(tag: string): Promise<string | null>;
}

export function gitClient(root: string, run: Run = capture): Git {
  const raw = async (args: string[]) => {
    const r = await run(["git", ...args], root);
    if (r.code !== 0) throw new GitError(`git ${args.join(" ")}: ${r.stderr.trim()}`);
    return r.stdout;
  };
  const out = async (args: string[]) => (await raw(args)).trim();
  return {
    out,
    ok: async (args) => (await run(["git", ...args], root)).code === 0,
    tree: (rev) => out(["rev-parse", `${rev}^{tree}`]),
    head: () => out(["rev-parse", "HEAD"]),
    branch: () => out(["branch", "--show-current"]),
    // Porcelain lines start with a space when only the worktree changed, so lines are not trimmed.
    dirty: async () => (await raw(["status", "--porcelain"])).split("\n").filter(Boolean),
    remoteTag: async (tag) => {
      const ref = `refs/tags/${tag}`;
      const lines = (await out(["ls-remote", "origin", ref, `${ref}^{}`])).split("\n");
      const find = (name: string) =>
        lines.map((l) => l.split("\t")).find(([, r]) => r === name)?.[0] ?? null;
      return find(`${ref}^{}`) ?? find(ref);
    },
  };
}
