import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../plugins/pmanager/skills/pmanager/scripts/git";
import { exists } from "./adapters/claude-code";
import { hashTree, SKILL_SKIP } from "./hashes";
import { REPO_ROOT } from "./skill-paths";

export interface BaselineInfo {
  ref: string;
  sha: string;
  skillHash: string;
}

export const SKILL_REL = "plugins/pmanager/skills/pmanager";

/** A fresh extraction outside the repository; `remove()` deletes only what it created. */
export interface BaselineCopy {
  dir: string;
  hash: string;
  remove(): Promise<void>;
}

export async function resolveCommit(ref: string, root = REPO_ROOT): Promise<string> {
  const r = await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root);
  if (r.code !== 0) throw new Error(`--baseline ${ref} is not a commit in ${root}`);
  return r.stdout.trim();
}

/**
 * The skill directory exactly as committed at `sha`, extracted into `dest`; returns its hash.
 * Never replaces anything: an existing `dest` is refused, so nothing is deleted.
 */
export async function extractSkill(sha: string, dest: string, root = REPO_ROOT): Promise<string> {
  if (await exists(dest)) throw new Error(`${dest} already exists; move it aside first`);
  const tmp = await mkdtemp(join(tmpdir(), "pm-bench-baseline-"));
  const tar = join(tmp, "skill.tar");
  try {
    const r = await git(
      ["archive", "--format=tar", `--output=${tar}`, `${sha}:${SKILL_REL}`],
      root,
    );
    if (r.code !== 0) {
      throw new Error(`git archive ${sha}:${SKILL_REL} failed: ${r.stderr.trim()}`);
    }
    await mkdir(dest, { recursive: true });
    const x = Bun.spawn(["tar", "-xf", tar, "-C", dest], { stdout: "ignore", stderr: "pipe" });
    const [err, code] = await Promise.all([new Response(x.stderr).text(), x.exited]);
    if (code !== 0) throw new Error(`tar -xf failed: ${err.trim()}`);
    return hashTree(dest, SKILL_SKIP);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Extracts the skill at `sha` into a new temp directory. Kept out of the repository so the bench's
 * own lint, typecheck and tests never see an old skill's config and test files.
 */
export async function extractBaseline(sha: string, tmp = tmpdir()): Promise<BaselineCopy> {
  const parent = await mkdtemp(join(tmp, "pm-bench-baseline-"));
  const remove = () => rm(parent, { recursive: true, force: true });
  try {
    const dir = join(parent, "skill");
    return { dir, hash: await extractSkill(sha, dir), remove };
  } catch (e) {
    await remove();
    throw e;
  }
}

export function hashProblem(b: BaselineInfo, hash: string): string | null {
  return hash === b.skillHash
    ? null
    : `baseline skill hash ${hash} differs from manifest ${b.skillHash}`;
}

/** Re-extracts the pinned commit and compares it with the manifest; leaves nothing behind. */
export async function baselineProblem(b: BaselineInfo, tmp = tmpdir()): Promise<string | null> {
  let copy: BaselineCopy;
  try {
    copy = await extractBaseline(b.sha, tmp);
  } catch (e) {
    return `baseline skill at ${b.sha} unavailable: ${(e as Error).message}`;
  }
  await copy.remove();
  return hashProblem(b, copy.hash);
}
