import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { git, gitOk } from "../plugins/pmanager/skills/pmanager/scripts/git";

export interface FixtureInfo {
  baselineSha: string;
  originBare: string | null;
  originRefs: Record<string, string>;
  epicSlugsBefore: string[];
  /** path → "<git status code>|<sha256 of content or deleted>" for every path dirty at build time */
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

export interface PorcelainEntry {
  /** the two-character status code, e.g. "??", " M", "A ", "M " */
  code: string;
  path: string;
}

export function porcelainEntries(out: string): PorcelainEntry[] {
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const p = l.slice(3).trim();
      const arrow = p.indexOf(" -> ");
      return { code: l.slice(0, 2), path: arrow === -1 ? p : p.slice(arrow + 4) };
    });
}

export function porcelainPaths(out: string): string[] {
  return porcelainEntries(out).map((e) => e.path);
}

/** Index state and content together, so staging an unchanged file still counts as a change. */
export async function dirtyState(dir: string, entry: PorcelainEntry): Promise<string> {
  return `${entry.code}|${await contentHash(dir, entry.path)}`;
}

export async function snapshotDirty(dir: string): Promise<Record<string, string>> {
  const entries = porcelainEntries(
    await gitOk(["status", "--porcelain", "--untracked-files=all"], dir),
  );
  const out: Record<string, string> = {};
  for (const e of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    out[e.path] = await dirtyState(dir, e);
  }
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

/** Fixtures are temp dirs; a leaked sibling worktree would keep the parent alive. */
export async function cleanupFixture(dir: string): Promise<void> {
  await git(["worktree", "prune"], dir);
  const parent = dirname(dir);
  const prefix = `${basename(dir)}-pm-`;
  const siblings = await readdir(parent).catch(() => [] as string[]);
  for (const name of siblings) {
    if (name.startsWith(prefix)) await rm(join(parent, name), { recursive: true, force: true });
  }
  await rm(dir, { recursive: true, force: true });
}
