import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  rawLogPath: string;
  graceMs?: number;
  stdin?: string;
}

export interface SpawnResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

const DRAIN_MS = 500;

async function collect(
  stream: ReadableStream<Uint8Array>,
  exited: Promise<unknown>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let finished = false;
  exited.then(() => {
    setTimeout(() => {
      if (!finished) reader.cancel().catch(() => undefined);
    }, DRAIN_MS);
  });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  finished = true;
  return Buffer.concat(chunks).toString("utf8");
}

export async function spawnWithTimeout(cmd: string[], opts: SpawnOptions): Promise<SpawnResult> {
  const started = performance.now();
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const grace = opts.graceMs ?? 10_000;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGINT");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGTERM");
    }, grace);
  }, opts.timeoutMs);
  const [stdout, stderr] = await Promise.all([
    collect(proc.stdout, proc.exited),
    collect(proc.stderr, proc.exited),
  ]);
  await proc.exited;
  clearTimeout(timer);
  await mkdir(dirname(opts.rawLogPath), { recursive: true });
  await writeFile(opts.rawLogPath, stdout);
  return {
    exitCode: timedOut ? null : proc.exitCode,
    timedOut,
    durationMs: Math.round(performance.now() - started),
    stdout,
    stderr,
  };
}
