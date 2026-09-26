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
export const BASELINE_DIR = "baseline-skill";

export async function resolveCommit(ref: string, root = REPO_ROOT): Promise<string> {
  const r = await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root);
  if (r.code !== 0) throw new Error(`--baseline ${ref} is not a commit in ${root}`);
  return r.stdout.trim();
}

/** The skill directory exactly as committed at `sha`, extracted into `dest`; returns its hash. */
export async function extractSkill(sha: string, dest: string, root = REPO_ROOT): Promise<string> {
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
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    const x = Bun.spawn(["tar", "-xf", tar, "-C", dest], { stdout: "ignore", stderr: "pipe" });
    const [err, code] = await Promise.all([new Response(x.stderr).text(), x.exited]);
    if (code !== 0) throw new Error(`tar -xf failed: ${err.trim()}`);
    return hashTree(dest, SKILL_SKIP);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** The copy is gitignored, so a missing one is re-extracted before it is compared. */
export async function baselineProblem(
  experimentDir: string,
  b: BaselineInfo,
): Promise<string | null> {
  const dest = join(experimentDir, BASELINE_DIR);
  let hash: string;
  try {
    hash = (await exists(dest))
      ? await hashTree(dest, SKILL_SKIP)
      : await extractSkill(b.sha, dest);
  } catch (e) {
    return `baseline skill at ${b.sha} unavailable: ${(e as Error).message}`;
  }
  return hash === b.skillHash
    ? null
    : `baseline skill hash ${hash} differs from manifest ${b.skillHash}`;
}
