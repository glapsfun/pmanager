export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function git(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function gitOk(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
  }
  return r.stdout;
}

export async function repoRoot(cwd: string): Promise<string | null> {
  const r = await git(["rev-parse", "--show-toplevel"], cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function hasRemote(cwd: string, name = "origin"): Promise<boolean> {
  const r = await git(["remote", "get-url", name], cwd);
  return r.code === 0;
}

/** Refresh origin/pm/* exactly, whatever the clone's configured refspec (single-branch clones included). */
export async function fetchOrigin(cwd: string): Promise<boolean> {
  const refspec = "+refs/heads/pm/*:refs/remotes/origin/pm/*";
  return (await git(["fetch", "-q", "--prune", "origin", refspec], cwd)).code === 0;
}

export async function listRemoteBranches(cwd: string, prefix: string): Promise<string[]> {
  const r = await git(["ls-remote", "--heads", "origin", `refs/heads/${prefix}*`], cwd);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.split("\t")[1] ?? "")
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.slice("refs/heads/".length))
    .sort();
}

/** Branches under origin/<prefix> as known locally; exact right after a pruned fetch, no network. */
export async function listFetchedBranches(cwd: string, prefix: string): Promise<string[]> {
  const r = await git(
    ["for-each-ref", "--format=%(refname)", `refs/remotes/origin/${prefix}`],
    cwd,
  );
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((ref) => ref.startsWith("refs/remotes/origin/"))
    .map((ref) => ref.slice("refs/remotes/origin/".length))
    .sort();
}

export async function remoteBranchExists(cwd: string, branch: string): Promise<boolean> {
  return (await listRemoteBranches(cwd, branch)).includes(branch);
}

export async function readFileAtRef(
  cwd: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const r = await git(["show", `${ref}:${path}`], cwd);
  return r.code === 0 ? r.stdout : null;
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
}

export async function localBranchExists(cwd: string, name: string): Promise<boolean> {
  return (await git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], cwd)).code === 0;
}

export async function checkoutBranch(
  cwd: string,
  name: string,
  create: boolean,
  startPoint?: string,
): Promise<void> {
  const args = create
    ? ["checkout", "-q", "-b", name, ...(startPoint ? [startPoint] : [])]
    : ["checkout", "-q", name];
  await gitOk(args, cwd);
}

export async function deleteLocalBranch(cwd: string, name: string): Promise<void> {
  await git(["branch", "-q", "-D", name], cwd);
}

export async function commitPaths(cwd: string, paths: string[], message: string): Promise<void> {
  await gitOk(["add", "--", ...paths], cwd);
  await gitOk(["commit", "-q", "-m", message, "--", ...paths], cwd);
}

export async function pushSetUpstream(cwd: string, branch: string): Promise<GitResult> {
  return git(["push", "-q", "--set-upstream", "origin", `${branch}:${branch}`], cwd);
}
