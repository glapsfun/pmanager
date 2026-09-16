import { appendFile, cp, mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git, gitOk } from "../plugins/pmanager/skills/pmanager/scripts/git";

export interface FixtureInfo {
  baselineSha: string;
  originBare: string | null;
  originRefs: Record<string, string>;
  epicSlugsBefore: string[];
  ignorePaths: string[];
}

export const SKILL_LINKS = [".agents/skills/pmanager", ".claude/skills/pmanager"] as const;

export async function headSha(dir: string): Promise<string> {
  return (await gitOk(["rev-parse", "HEAD"], dir)).trim();
}

export async function lsRemoteRefs(dir: string, remote: string): Promise<Record<string, string>> {
  const r = await git(["ls-remote", "--heads", remote], dir);
  if (r.code !== 0) return {};
  const out: Record<string, string> = {};
  for (const line of r.stdout.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha && ref) out[ref] = sha;
  }
  return out;
}

export async function gitCommitAll(dir: string, message: string): Promise<void> {
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", message], dir);
}

async function linkOrCopy(target: string, linkPath: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  try {
    await symlink(target, linkPath, "dir");
  } catch {
    await cp(target, linkPath, { recursive: true });
  }
}

export async function linkSkill(fixtureDir: string, skillDir: string): Promise<void> {
  for (const rel of SKILL_LINKS) await linkOrCopy(skillDir, join(fixtureDir, rel));
  const exclude = join(fixtureDir, ".git", "info", "exclude");
  await mkdir(dirname(exclude), { recursive: true });
  await appendFile(exclude, ".agents/\n.claude/\n");
}
