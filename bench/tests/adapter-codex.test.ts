import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { codex, parseCodexStream } from "../adapters/codex";

describe("codex adapter", () => {
  test("sums usage across turns, counts items, keeps commands and the last agent message", async () => {
    const raw = await readFile(join(import.meta.dir, "samples", "codex.jsonl"), "utf8");
    expect(parseCodexStream(raw)).toEqual({
      tokens: { input: 5000, output: 600, cacheRead: 3900, cacheWrite: 50 },
      costUsd: null,
      turns: null,
      toolCalls: { command_execution: 2, file_change: 1 },
      commands: ["git log --oneline -5", "bun run .agents/skills/pmanager/scripts/pm.ts check"],
      finalMessage: "Committed on pm/x; awaiting approval.",
      model: null,
    });
  });

  test("no turn.completed yields null tokens", () => {
    const t = parseCodexStream('{"type":"thread.started","thread_id":"x"}\n');
    expect(t.tokens).toBeNull();
    expect(t.toolCalls).toEqual({});
    expect(t.finalMessage).toBeNull();
  });

  test("turn.failed clears the final message so run-completed fails", () => {
    const t = parseCodexStream(
      '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"hi"}}\n{"type":"turn.failed","error":{"message":"rate limited"}}\n',
    );
    expect(t.finalMessage).toBeNull();
  });

  test("adapter metadata", () => {
    expect(codex.name).toBe("codex");
    expect(codex.envPassthrough).toContain("OPENAI_API_KEY");
  });
});
