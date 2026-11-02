import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { type Config, defaultConfig, REPO_ROOT } from "../scripts/config";

export interface Fixture {
  root: string;
  bare: string;
  cfg: Config;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A clone at root of a bare origin, holding the shipped files at 0.10.0, tagged v0.10.0 unless tagged is false. */
export async function makeFixture(opts: { tagged?: boolean } = {}): Promise<Fixture> {
  const base = await makeTempDir("release");
  const bare = join(base, "origin.git");
  const root = join(base, "work");
  await gitOk(["init", "-q", "--bare", "-b", "main", bare], base);
  mkdirSync(root);
  await initGitRepo(root);
  const real = defaultConfig();
  const files: Record<string, string> = {
    "plugins/pmanager/skills/pmanager/SKILL.md": "skill\n",
    "README.md": "readme\n",
  };
  for (const p of [...real.manifests, real.marketplace]) {
    files[p] = readFileSync(join(REPO_ROOT, p), "utf8").replace(
      /"version": "[^"]+"/,
      '"version": "0.10.0"',
    );
  }
  await writeTree(root, files);
  await gitOk(["add", "-A"], root);
  await gitOk(["commit", "-q", "-m", "feat: initial"], root);
  await gitOk(["remote", "add", "origin", bare], root);
  await gitOk(["push", "-q", "-u", "origin", "main"], root);
  if (opts.tagged !== false) {
    await gitOk(["tag", "-a", "v0.10.0", "-m", "pmanager v0.10.0"], root);
    await gitOk(["push", "-q", "origin", "refs/tags/v0.10.0"], root);
  }
  const cfg: Config = {
    ...defaultConfig(root),
    slug: "acme/demo",
    originPattern: new RegExp(`${escapeRe(bare)}$`),
  };
  return { root, bare, cfg };
}

/** A throwaway clone of origin for changes made by "someone else". */
export async function scratchClone(f: Fixture): Promise<string> {
  const dir = join(await makeTempDir("clone"), "c");
  await gitOk(["clone", "-q", f.bare, dir], f.root);
  await gitOk(["config", "user.name", "other"], dir);
  await gitOk(["config", "user.email", "other@example.com"], dir);
  return dir;
}

/** Fetches into root and fast-forwards root's main when it is checked out and clean. */
export async function syncRoot(f: Fixture): Promise<void> {
  await gitOk(["fetch", "-q", "origin", "--tags"], f.root);
  const branch = (await gitOk(["branch", "--show-current"], f.root)).trim();
  const dirty = (await gitOk(["status", "--porcelain"], f.root)).trim();
  if (branch === "main" && dirty === "") {
    await gitOk(["merge", "-q", "--ff-only", "origin/main"], f.root);
  }
}

async function commitIn(
  dir: string,
  files: Record<string, string>,
  subject: string,
  body?: string,
) {
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", subject, ...(body ? ["-m", body] : [])], dir);
  return (await gitOk(["rev-parse", "HEAD"], dir)).trim();
}

/** Commits on origin's main from another clone, then syncs root. Returns the commit. */
export async function commitAndPush(
  f: Fixture,
  files: Record<string, string>,
  subject: string,
  body?: string,
): Promise<string> {
  const dir = await scratchClone(f);
  const sha = await commitIn(dir, files, subject, body);
  await gitOk(["push", "-q", "origin", "main"], dir);
  await syncRoot(f);
  return sha;
}

/** Commits on a new branch of origin, branched from origin's main. Returns the commit. */
export async function commitOnBranch(
  f: Fixture,
  branch: string,
  files: Record<string, string>,
  subject: string,
): Promise<string> {
  const dir = await scratchClone(f);
  await gitOk(["switch", "-q", "-c", branch], dir);
  const sha = await commitIn(dir, files, subject);
  await gitOk(["push", "-q", "origin", branch], dir);
  return sha;
}

/** Merges origin's branch into main the way GitHub does for PR number pr. Returns the merge commit. */
export async function mergePrIntoMain(
  f: Fixture,
  branch: string,
  pr: number,
  extra: Record<string, string> = {},
): Promise<string> {
  const dir = await scratchClone(f);
  const message = `Merge pull request #${pr} from acme/${branch}`;
  await gitOk(["merge", "-q", "--no-ff", "--no-commit", `origin/${branch}`], dir);
  if (Object.keys(extra).length > 0) {
    await writeTree(dir, extra);
    await gitOk(["add", "-A"], dir);
  }
  await gitOk(["commit", "-q", "-m", message], dir);
  await gitOk(["push", "-q", "origin", "main"], dir);
  await syncRoot(f);
  return (await gitOk(["rev-parse", "HEAD"], dir)).trim();
}
