/** Runs a command with inherited stdio and returns its exit code. */
export async function sh(
  cmd: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

/** Runs a command and returns its exit code with captured output. With inherit false, env is the whole environment. */
export async function capture(
  cmd: string[],
  cwd: string,
  env?: Record<string, string>,
  inherit = true,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: inherit ? { ...process.env, ...env } : env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
