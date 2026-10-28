import type { capture } from "./proc";

export type Git = (args: string[]) => ReturnType<typeof capture>;

const ZEROS = /^0+$/;

/** Fails on a dirty working tree; given the hook's stdin, warns for each pushed ref that is not HEAD. */
export async function prePushGuard(
  git: Git,
  stdin: string | undefined,
  err: (s: string) => void = (s) => console.error(s),
): Promise<boolean> {
  const status = await git(["status", "--porcelain"]);
  if (status.code !== 0) {
    err(`pre-push: git status failed: ${status.stderr.trim()}`);
    return false;
  }
  const dirty = status.stdout.split("\n").filter(Boolean);
  if (dirty.length > 0) {
    err("pre-push checks the working tree, so commit, stash or remove these first:");
    for (const line of dirty) err(`  ${line}`);
    return false;
  }
  if (stdin === undefined) return true;
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const short = (await git(["rev-parse", "--short", "HEAD"])).stdout.trim();
  for (const line of stdin.split("\n")) {
    const [ref, sha] = line.trim().split(/\s+/);
    if (!ref || !sha || ZEROS.test(sha)) continue;
    const pushed = await git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
    if (pushed.stdout.trim() !== head) {
      err(`pre-push checked HEAD ${short}, not ${ref}; CI will check it`);
    }
  }
  return true;
}
