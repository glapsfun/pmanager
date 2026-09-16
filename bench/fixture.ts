import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { git, gitOk } from "../plugins/pmanager/skills/pmanager/scripts/git";

export interface FixtureInfo {
  baselineSha: string;
  originBare: string | null;
  originRefs: Record<string, string>;
  epicSlugsBefore: string[];
  /** path → sha256 of content (or "deleted") for every path dirty when the fixture was built */
  initialDirty: Record<string, string>;
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

export async function contentHash(dir: string, rel: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await readFile(join(dir, rel)))
      .digest("hex");
  } catch {
    return "deleted";
  }
}

export function porcelainPaths(out: string): string[] {
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const p = l.slice(3).trim();
      const arrow = p.indexOf(" -> ");
      return arrow === -1 ? p : p.slice(arrow + 4);
    });
}

export async function snapshotDirty(dir: string): Promise<Record<string, string>> {
  const paths = porcelainPaths(
    await gitOk(["status", "--porcelain", "--untracked-files=all"], dir),
  );
  const out: Record<string, string> = {};
  for (const p of paths.sort()) out[p] = await contentHash(dir, p);
  return out;
}

export async function gitCommitAll(dir: string, message: string): Promise<void> {
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", message], dir);
}

const SKIP = new Set(["node_modules", "bun.lock", ".git"]);

/** Copies, never symlinks: the harness runs with permission checks off and must not reach the real tree. */
async function copySkill(skillDir: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  await cp(skillDir, dest, {
    recursive: true,
    filter: (src) => !SKIP.has(basename(src)),
  });
}

export async function linkSkill(fixtureDir: string, skillDir: string): Promise<void> {
  for (const rel of SKILL_LINKS) await copySkill(skillDir, join(fixtureDir, rel));
  const exclude = join(fixtureDir, ".git", "info", "exclude");
  await mkdir(dirname(exclude), { recursive: true });
  await appendFile(exclude, ".agents/\n.claude/\n");
}
