import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
}

export async function git(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function gitOk(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

export async function initGitRepo(dir: string): Promise<void> {
  await gitOk(["init", "-q", "-b", "main"], dir);
  await gitOk(["config", "user.name", "test"], dir);
  await gitOk(["config", "user.email", "test@example.com"], dir);
  await gitOk(["commit", "-q", "--allow-empty", "-m", "init"], dir);
}

export const FIXTURE_WEBSHOP = join(import.meta.dir, "fixtures", "webshop");

export async function copyFixture(dest: string): Promise<void> {
  await cp(FIXTURE_WEBSHOP, dest, { recursive: true });
}

export async function remoteWithClones(
  seedFiles: Record<string, string>,
): Promise<{ bare: string; a: string; b: string }> {
  const base = await makeTempDir("remote");
  const bare = join(base, "origin.git");
  const a = join(base, "a");
  const b = join(base, "b");
  await mkdir(bare, { recursive: true });
  await gitOk(["init", "-q", "--bare", "-b", "main"], bare);
  await gitOk(["clone", "-q", bare, a], base);
  await gitOk(["config", "user.name", "a"], a);
  await gitOk(["config", "user.email", "a@example.com"], a);
  await writeTree(a, seedFiles);
  await gitOk(["add", "-A"], a);
  await gitOk(["commit", "-q", "-m", "seed"], a);
  await gitOk(["push", "-q", "-u", "origin", "main"], a);
  await gitOk(["clone", "-q", bare, b], base);
  await gitOk(["config", "user.name", "b"], b);
  await gitOk(["config", "user.email", "b@example.com"], b);
  return { bare, a, b };
}

export async function fixtureFiles(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r);
      else out[r] = await readFile(p, "utf8");
    }
  };
  await walk(FIXTURE_WEBSHOP, "");
  return out;
}

/** Fixture files with the epic's session block removed (epic unclaimed). */
export async function unclaimedSeed(): Promise<Record<string, string>> {
  const files = await fixtureFiles();
  const epic = "docs/pm/app-performance/epic.md";
  files[epic] = (files[epic] ?? "").replace(
    "session:\n  harness: claude-code\n  claimed: 2026-09-10\n  branch: pm/app-performance\n",
    "",
  );
  files["docs/pm/INDEX.md"] = (files["docs/pm/INDEX.md"] ?? "").replace(
    "claude-code · 2026-09-10",
    "—",
  );
  return files;
}
