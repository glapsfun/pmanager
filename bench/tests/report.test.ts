import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunLine, ToolBenchLine } from "../history";
import { renderReport } from "../report";

function agent(over: Partial<AgentRunLine>): AgentRunLine {
  return {
    kind: "agent",
    date: "2026-09-15T10:00:00Z",
    sha: "abc1234",
    skillVersion: "0.2.0",
    harness: "codex",
    harnessVersion: "0.154.0",
    model: "gpt-5.4",
    scenario: "perf-bug-new-epic",
    run: 1,
    score: 0.5,
    failed: ["non-goals"],
    skipped: [],
    durationMs: 60000,
    timedOut: false,
    exitCode: 0,
    telemetry: {
      tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
      costUsd: null,
      turns: null,
      toolCalls: { command_execution: 3 },
    },
    ...over,
  };
}

const tool: ToolBenchLine = {
  kind: "tool",
  date: "2026-09-15T10:05:00Z",
  sha: "abc1234",
  skillVersion: "0.2.0",
  epics: 50,
  tasks: 1000,
  iterations: 5,
  statusMs: { median: 90, max: 110 },
  checkMs: { median: 300, max: 345 },
  renderMs: { median: 200, max: 230 },
};

describe("renderReport", () => {
  test("matches the golden file", async () => {
    const lines = [
      agent({ date: "2026-09-14T10:00:00Z", sha: "0000000", score: 0.25, durationMs: 90000 }),
      agent({}),
      agent({
        harness: "claude-code",
        harnessVersion: "2.1.272",
        model: "claude-sonnet-5",
        score: 1,
        failed: [],
        telemetry: {
          tokens: { input: 5000, output: 400, cacheRead: 3000, cacheWrite: 100 },
          costUsd: 0.42,
          turns: 12,
          toolCalls: { Bash: 7, Read: 4 },
        },
      }),
      {
        ...tool,
        date: "2026-09-14T10:05:00Z",
        sha: "0000000",
        statusMs: { median: 100, max: 120 },
      },
      tool,
    ];
    const golden = await readFile(join(import.meta.dir, "golden", "BENCH.md"), "utf8");
    expect(renderReport(lines)).toBe(golden);
  });

  test("empty history renders the headings only", () => {
    const out = renderReport([]);
    expect(out).toContain("# PManager benchmark");
    expect(out).toContain("_no agent runs recorded_");
    expect(out).toContain("_no tool microbench recorded_");
  });
});
