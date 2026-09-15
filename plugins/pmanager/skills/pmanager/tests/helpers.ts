import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
