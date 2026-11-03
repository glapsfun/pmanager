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

/**
 * Runs a command and returns its exit code with captured output. With inherit false, env is the
 * whole environment. With timeoutMs, a command still running then is killed and reported as code 124.
 */
export async function capture(
  cmd: string[],
  cwd: string,
  env?: Record<string, string>,
  inherit = true,
  timeoutMs?: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: inherit ? { ...process.env, ...env } : env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const done = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    if (timeoutMs !== undefined) timer = setTimeout(() => resolve("expired"), timeoutMs);
  });
  const first = await Promise.race([done, expired]);
  clearTimeout(timer);
  if (first === "expired") {
    // A hung command may ignore SIGTERM; its partial output is not worth waiting for.
    proc.kill("SIGKILL");
    return { code: 124, stdout: "", stderr: `timed out after ${(timeoutMs ?? 0) / 1000}s` };
  }
  const [stdout, stderr, code] = first;
  return { code, stdout, stderr };
}
