import { PM_DIR } from "../plugins/pmanager/skills/pmanager/scripts/repo";
import type { capture } from "./proc";

export type Git = (args: string[]) => ReturnType<typeof capture>;

export type Guard = "run" | "skip" | "fail";

const ZEROS = /^0+$/;

/** Local shas of the pushed refs, skipping deletions. */
function pushedShas(stdin: string): string[] {
  const shas: string[] = [];
  for (const line of stdin.split("\n")) {
    const [ref, sha] = line.trim().split(/\s+/);
    if (ref && sha && !ZEROS.test(sha)) shas.push(sha);
  }
  return shas;
}

/** Files changed by pushed commits no remote has yet; null when a merge is among them or git fails. */
export async function pushedPaths(git: Git, shas: string[]): Promise<string[] | null> {
  if (shas.length === 0) return [];
  const merges = await git(["rev-list", "--min-parents=2", ...shas, "--not", "--remotes"]);
  if (merges.code !== 0 || merges.stdout.trim() !== "") return null;
  const log = await git(["log", "--format=", "--name-only", "-z", ...shas, "--not", "--remotes"]);
  if (log.code !== 0) return null;
  return log.stdout.split("\0").filter(Boolean);
}

/**
 * Decides whether pre-push runs its checks. Given the hook's stdin, a push whose new commits
 * change only pm state under docs/pm is skipped. Otherwise a dirty tree fails, and each pushed
 * ref that is not HEAD gets a warning.
 */
export async function prePushGuard(
  git: Git,
  stdin: string | undefined,
  err: (s: string) => void = (s) => console.error(s),
): Promise<Guard> {
  if (stdin !== undefined) {
    const paths = await pushedPaths(git, pushedShas(stdin));
    if (paths?.every((p) => p.startsWith(`${PM_DIR}/`))) {
      err(
        `pre-push: the pushed commits change nothing outside ${PM_DIR}, so there is nothing to check`,
      );
      return "skip";
    }
  }
  const status = await git(["status", "--porcelain"]);
  if (status.code !== 0) {
    err(`pre-push: git status failed: ${status.stderr.trim()}`);
    return "fail";
  }
  const dirty = status.stdout.split("\n").filter(Boolean);
  if (dirty.length > 0) {
    err("pre-push checks the working tree, so commit, stash or remove these first:");
    for (const line of dirty) err(`  ${line}`);
    return "fail";
  }
  if (stdin === undefined) return "run";
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
  return "run";
}
