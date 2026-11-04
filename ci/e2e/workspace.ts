import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shiftDates } from "./dates";
import { playStory } from "./story";

/** The day the four repos are created, before the story's first epic. */
export const BASE_DAY = "2026-10-19";

// Placeholder origins: they identify the targets in epics and repos.json; nothing fetches them.
export const TARGETS = {
  webshop: "https://github.com/pm-example/webshop.git",
  infra: "https://github.com/pm-example/infra.git",
  argocd: "https://github.com/pm-example/argocd.git",
} as const;

export type TargetName = keyof typeof TARGETS;

export interface Workspace {
  dir: string;
  manager: string;
  remote: string;
  repos: Record<TargetName, string>;
  worktree(slug: string): string;
}

const FIXTURES = join(import.meta.dir, "fixtures", "multi-repo");
const AUTHOR = ["-c", "user.name=pm-example", "-c", "user.email=pm-example@example.invalid"];

/** Runs a command; a non-zero exit throws with its stderr so a broken build step names itself. */
export async function sh(
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} (in ${cwd}) exited ${code}: ${stderr.trim()}`);
  return stdout;
}

/** Noon keeps a day's commits inside verify's start-of-day window whatever the timezone offset. */
export function gitDateEnv(day: string): Record<string, string> {
  const at = `${day}T12:00:00`;
  return { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
}

async function createRepo(dir: string, name: string, origin: string, env: Record<string, string>) {
  await cp(join(FIXTURES, name), dir, { recursive: true });
  await sh(["git", "init", "-q", "-b", "main"], dir);
  await sh(["git", "add", "-A"], dir);
  await sh(["git", ...AUTHOR, "commit", "-q", "-m", `chore: initial ${name}`], dir, env);
  await sh(["git", "remote", "add", "origin", origin], dir);
}

/**
 * The four repos and the repo map, nothing planned yet. Rebuilding into the
 * same dir starts from scratch, so a test run never sees an earlier one.
 */
export async function buildBase(
  dir: string,
  opts: { install?: string; shiftDays?: number } = {},
): Promise<Workspace> {
  const root = join(dir, "workspace");
  const remotes = join(dir, "remotes");
  await rm(root, { recursive: true, force: true });
  await rm(remotes, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const env = gitDateEnv(shiftDates(BASE_DAY, opts.shiftDays ?? 0));

  const repos = {} as Record<TargetName, string>;
  for (const name of Object.keys(TARGETS) as TargetName[]) {
    repos[name] = join(root, name);
    await createRepo(repos[name], name, TARGETS[name], env);
  }

  // pm pushes claim branches, so the manager's origin must accept pushes.
  const remote = join(remotes, "manager.git");
  await mkdir(remotes, { recursive: true });
  await sh(["git", "init", "-q", "--bare", "-b", "main", remote], dir);
  const manager = join(root, "manager");
  await createRepo(manager, "manager", remote, env);
  // pm commits planning documents here; a CI runner may have no global git identity.
  await sh(["git", "config", "user.name", "pm-example"], manager);
  await sh(["git", "config", "user.email", "pm-example@example.invalid"], manager);
  if (opts.install) {
    await sh(
      [
        "gskill",
        "add",
        opts.install,
        "--skill",
        "pmanager",
        "--agent",
        "claude",
        "--no-interactive",
        "--yes",
      ],
      manager,
    );
    await sh(["git", "add", "-A"], manager);
    await sh(["git", "commit", "-q", "-m", "chore: add pmanager skill"], manager, env);
  }
  await sh(["git", "push", "-q", "-u", "origin", "main"], manager);

  // The same form pm itself creates: machine-local and ignored by git.
  const local = join(manager, "docs", "pm", ".local");
  await mkdir(local, { recursive: true });
  await writeFile(join(local, ".gitignore"), "*\n");
  const map = Object.fromEntries(
    (Object.keys(TARGETS) as TargetName[]).map((name) => [TARGETS[name], repos[name]]),
  );
  await writeFile(join(local, "repos.json"), `${JSON.stringify(map, null, 2)}\n`);

  return { dir, manager, remote, repos, worktree: (slug) => join(root, `manager-pm-${slug}`) };
}

/** The base workspace with the whole story played into it. */
export async function buildWorkspace(
  dir: string,
  opts: { install?: string; shiftDays?: number } = {},
): Promise<Workspace> {
  const ws = await buildBase(dir, opts);
  await playStory(ws, { shiftDays: opts.shiftDays ?? 0 });
  return ws;
}
