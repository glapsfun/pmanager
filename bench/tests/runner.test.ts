import { describe, expect, test } from "bun:test";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyFixture, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { Adapter, RunOptions, RunOutcome } from "../adapters/types";
import { gitCommitAll } from "../fixture";
import { readHistory } from "../history";
import { runScenario } from "../runner";
import { scenarioByName } from "../scenarios/registry";
import type { Scenario } from "../scenarios/types";

function fakeAdapter(act: (opts: RunOptions) => Promise<void>): Adapter {
  return {
    name: "codex",
    defaultModel: "fake-model",
    envPassthrough: [],
    async detect() {
      return { available: true, version: "0.0.0" };
    },
    async run(opts): Promise<RunOutcome> {
      await act(opts);
      await writeFile(opts.rawLogPath, "{}\n");
      return {
        exitCode: 0,
        timedOut: false,
        durationMs: 5,
        rawLogPath: opts.rawLogPath,
        telemetry: {
          tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
          costUsd: null,
          turns: null,
          toolCalls: { command_execution: 1 },
          commands: ["ls"],
          finalMessage: "done",
          model: "reported-model",
        },
      };
    },
  };
}

const META = { sha: "abc1234", skillVersion: "0.2.0", harnessVersion: "0.0.0" };

describe("runScenario", () => {
  test("a fake adapter that restores the fixture docs scores well and appends history", async () => {
    const scenario = scenarioByName("perf-bug-new-epic") as Scenario;
    const historyPath = join(await makeTempDir("bench-runner"), "history.jsonl");
    const adapter = fakeAdapter(async (opts) => {
      expect(opts.env.PM_TODAY).toBe("2026-09-15");
      expect(opts.prompt).toBe(scenario.prompt);
      await stat(join(opts.cwd, ".agents", "skills", "pmanager", "SKILL.md"));
      await copyFixture(opts.cwd);
      const epic = join(opts.cwd, "docs", "pm", "app-performance", "epic.md");
      const raw = await Bun.file(epic).text();
      await writeFile(epic, raw.replace("status: in-progress", "status: draft"));
      await gitCommitAll(opts.cwd, "docs(pm): spec app-performance");
    });
    const result = await runScenario({
      adapter,
      scenario,
      model: undefined,
      timeoutMs: 10_000,
      keep: false,
      run: 1,
      historyPath,
      rawDir: await makeTempDir("bench-raw"),
      meta: META,
    });
    expect(result.line.kind).toBe("agent");
    expect(result.line.model).toBe("fake-model");
    expect((result.line.telemetry as Record<string, unknown>).model).toBeUndefined();
    expect(result.line.harness).toBe("codex");
    expect(result.line.score).toBeGreaterThan(0.8);
    expect(result.line.telemetry.toolCalls).toEqual({ command_execution: 1 });
    expect((result.line.telemetry as Record<string, unknown>).finalMessage).toBeUndefined();
    expect(await readHistory(historyPath)).toEqual([result.line]);
    await expect(stat(result.fixtureDir)).rejects.toThrow();
  });

  test("keep leaves the fixture on disk and a no-op adapter scores low", async () => {
    const scenario = scenarioByName("perf-bug-new-epic") as Scenario;
    const historyPath = join(await makeTempDir("bench-runner"), "history.jsonl");
    const result = await runScenario({
      adapter: fakeAdapter(async () => {}),
      scenario,
      model: "m",
      timeoutMs: 10_000,
      keep: true,
      run: 2,
      historyPath,
      rawDir: await makeTempDir("bench-raw"),
      meta: META,
    });
    expect(result.line.model).toBe("m");
    expect(result.line.run).toBe(2);
    expect(result.line.score).toBeLessThan(0.5);
    expect((await stat(result.fixtureDir)).isDirectory()).toBe(true);
  });
});

describe("runScenario on a failed harness run", () => {
  test("no final message zeroes the score even when disk checks pass", async () => {
    const scenario = scenarioByName("two-session-claim-conflict") as Scenario;
    const historyPath = join(await makeTempDir("bench-runner"), "history.jsonl");
    const crashed: Adapter = {
      ...fakeAdapter(async () => {}),
      async run(opts): Promise<RunOutcome> {
        await writeFile(opts.rawLogPath, "");
        return {
          exitCode: 0,
          timedOut: false,
          durationMs: 1,
          rawLogPath: opts.rawLogPath,
          telemetry: {
            tokens: null,
            costUsd: null,
            turns: null,
            toolCalls: null,
            commands: null,
            finalMessage: null,
            model: null,
          },
        };
      },
    };
    const result = await runScenario({
      adapter: crashed,
      scenario,
      model: undefined,
      timeoutMs: 10_000,
      keep: false,
      run: 1,
      historyPath,
      rawDir: await makeTempDir("bench-raw"),
      meta: META,
    });
    expect(result.line.score).toBe(0);
    expect(result.line.failed).toEqual(["run-completed"]);
    expect(result.score.outcomes.find((o) => o.id === "nothing-written")?.passed).toBe(true);
  });

  test("a timed-out run is recorded as failed with exitCode null", async () => {
    const scenario = scenarioByName("two-session-claim-conflict") as Scenario;
    const historyPath = join(await makeTempDir("bench-runner"), "history.jsonl");
    const hung: Adapter = {
      ...fakeAdapter(async () => {}),
      async run(opts): Promise<RunOutcome> {
        await writeFile(opts.rawLogPath, "");
        const base = await fakeAdapter(async () => {}).run(opts);
        return { ...base, exitCode: null, timedOut: true };
      },
    };
    const result = await runScenario({
      adapter: hung,
      scenario,
      model: undefined,
      timeoutMs: 10_000,
      keep: false,
      run: 1,
      historyPath,
      rawDir: await makeTempDir("bench-raw"),
      meta: META,
    });
    expect(result.line.score).toBe(0);
    expect(result.line.timedOut).toBe(true);
    expect(result.line.exitCode).toBeNull();
    expect(result.line.failed).toContain("run-completed");
  });
});

describe("runScenario scoring", () => {
  test("a completed run failing one of four checks scores 0.75, not 0.80", async () => {
    const scenario = scenarioByName("two-session-claim-conflict") as Scenario;
    const historyPath = join(await makeTempDir("bench-runner"), "history.jsonl");
    const result = await runScenario({
      adapter: fakeAdapter(async () => {}),
      scenario,
      model: undefined,
      timeoutMs: 10_000,
      keep: false,
      run: 1,
      historyPath,
      rawDir: await makeTempDir("bench-raw"),
      meta: META,
    });
    expect(result.line.failed).toEqual(["names-owner"]);
    expect(result.line.score).toBe(0.75);
    expect(result.score.outcomes.map((o) => o.id)).toEqual([
      "run-completed",
      "nothing-written",
      "remote-untouched",
      "no-takeover",
      "names-owner",
    ]);
  });
});

describe("runScenario model fallback", () => {
  test("uses the harness-reported model when none was requested or defaulted", async () => {
    const scenario = scenarioByName("two-session-claim-conflict") as Scenario;
    const historyPath = join(await makeTempDir("bench-runner"), "history.jsonl");
    const adapter: Adapter = { ...fakeAdapter(async () => {}), defaultModel: undefined };
    const result = await runScenario({
      adapter,
      scenario,
      model: undefined,
      timeoutMs: 10_000,
      keep: false,
      run: 1,
      historyPath,
      rawDir: await makeTempDir("bench-raw"),
      meta: META,
    });
    expect(result.line.model).toBe("reported-model");
  });
});
