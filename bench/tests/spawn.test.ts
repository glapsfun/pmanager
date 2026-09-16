import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { spawnWithTimeout } from "../adapters/spawn";

describe("spawnWithTimeout", () => {
  test("captures stdout into the raw log and reports the exit code", async () => {
    const dir = await makeTempDir("bench-spawn");
    const rawLogPath = join(dir, "raw.jsonl");
    const r = await spawnWithTimeout(["sh", "-c", "echo '{\"a\":1}'; exit 3"], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5000,
      rawLogPath,
    });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toBe('{"a":1}\n');
    expect(await Bun.file(rawLogPath).text()).toBe('{"a":1}\n');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("kills a hanging process after the timeout", async () => {
    const dir = await makeTempDir("bench-spawn");
    const r = await spawnWithTimeout(["sh", "-c", "trap '' INT; sleep 30"], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 300,
      rawLogPath: join(dir, "raw.jsonl"),
      graceMs: 200,
    });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.durationMs).toBeLessThan(5000);
  });
});

describe("spawnWithTimeout process tree", () => {
  test("kills grandchildren that ignore SIGINT and SIGTERM", async () => {
    const dir = await makeTempDir("bench-spawn");
    const marker = `pm-bench-zombie-${process.pid}-${Date.now()}`;
    const r = await spawnWithTimeout(
      ["bash", "-c", `trap '' INT TERM; bash -c 'exec -a ${marker} sleep 60' & wait`],
      {
        cwd: dir,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 300,
        rawLogPath: join(dir, "raw.jsonl"),
        graceMs: 200,
      },
    );
    expect(r.timedOut).toBe(true);
    await Bun.sleep(300);
    const pgrep = Bun.spawn(["pgrep", "-f", marker], { stdout: "pipe" });
    const alive = (await new Response(pgrep.stdout).text()).trim();
    await pgrep.exited;
    expect(alive).toBe("");
  });
});
