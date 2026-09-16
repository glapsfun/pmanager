import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { type AgentRunLine, appendHistory, readHistory, type ToolBenchLine } from "../history";

const agent: AgentRunLine = {
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
  durationMs: 1000,
  timedOut: false,
  exitCode: 0,
  telemetry: { tokens: null, costUsd: null, turns: null, toolCalls: { command_execution: 3 } },
};

const tool: ToolBenchLine = {
  kind: "tool",
  date: "2026-09-15T10:05:00Z",
  sha: "abc1234",
  skillVersion: "0.2.0",
  epics: 2,
  tasks: 4,
  iterations: 3,
  statusMs: { median: 1, max: 2 },
  checkMs: { median: 1, max: 2 },
  renderMs: { median: 1, max: 2 },
};

describe("history", () => {
  test("appends one line per call and reads them back in order", async () => {
    const path = join(await makeTempDir("bench-history"), "results", "history.jsonl");
    await appendHistory(path, agent);
    await appendHistory(path, tool);
    const lines = await readHistory(path);
    expect(lines).toEqual([agent, tool]);
    const raw = await Bun.file(path).text();
    expect(raw.split("\n").filter(Boolean)).toHaveLength(2);
  });

  test("reading a missing file returns an empty list", async () => {
    const path = join(await makeTempDir("bench-history"), "none.jsonl");
    expect(await readHistory(path)).toEqual([]);
  });
});
