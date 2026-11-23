import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitTimed } from "../scripts/git";
import { runTimed } from "../scripts/proc";
import { initGitRepo, makeTempDir } from "./helpers";

describe("runTimed", () => {
  test("returns output and exit code", async () => {
    const r = await runTimed(["echo", "hi"], await makeTempDir("proc"), 5_000);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.timedOut).toBe(false);
  });
  test("kills the child and flags timedOut", async () => {
    const started = performance.now();
    const r = await runTimed(["sleep", "10"], await makeTempDir("proc"), 100);
    expect(r.timedOut).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
  test("a budget of zero runs nothing and is timed out", async () => {
    const dir = await makeTempDir("proc");
    const pending = runTimed(["sh", "-c", "echo ran > ran.txt"], dir, 0);
    // Hold the event loop so a spawned child would finish before any timer could fire, as on a
    // loaded CI runner: the zero budget must not depend on that race.
    const t = performance.now();
    while (performance.now() - t < 300) {}
    const r = await pending;
    expect(r.timedOut).toBe(true);
    expect(r.code).toBe(137);
    expect(existsSync(join(dir, "ran.txt"))).toBe(false);
  });
  test("missing binary is a failure result, not a throw", async () => {
    const r = await runTimed(["/nonexistent/binary"], await makeTempDir("proc"), 1_000);
    expect(r.code).not.toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});

describe("gitTimed", () => {
  test("runs git in the given repo", async () => {
    const dir = await makeTempDir("proc");
    await initGitRepo(dir);
    const r = await gitTimed(["rev-parse", "--abbrev-ref", "HEAD"], dir, 5_000);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("main");
  });
});
