export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a command under a wall-clock budget; on timeout the child is killed and timedOut is set. */
export async function runTimed(
  cmd: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string | undefined> = {},
): Promise<RunResult> {
  // No budget leaves no time to run, and a zero-delay timer can lose the race to a fast child.
  if (timeoutMs <= 0) return { code: 137, stdout: "", stderr: "", timedOut: true };
  try {
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr, timedOut };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const stderr = e instanceof Error ? e.message : String(e);
    return { code: 127, stdout: "", stderr, timedOut: false };
  }
}
