import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCode, parseClaudeStream } from "../adapters/claude-code";

describe("claude-code adapter", () => {
  test("parses usage, cost, turns, tool calls, commands and the final message", async () => {
    const raw = await readFile(join(import.meta.dir, "samples", "claude-code.jsonl"), "utf8");
    expect(parseClaudeStream(raw)).toEqual({
      tokens: { input: 1250, output: 380, cacheRead: 150, cacheWrite: 100 },
      costUsd: 0.0147,
      turns: 3,
      toolCalls: { Bash: 2, Read: 1 },
      commands: [
        "bun run .agents/skills/pmanager/scripts/pm.ts status --harness claude-code",
        "git log --oneline -5",
      ],
      finalMessage: "Epic written as draft; awaiting approval.",
      model: "claude-sonnet-5",
    });
  });

  test("garbage and a missing result yield nulls, not zeros", () => {
    const t = parseClaudeStream('not json\n{"type":"assistant","message":{"content":[]}}\n');
    expect(t.tokens).toBeNull();
    expect(t.costUsd).toBeNull();
    expect(t.turns).toBeNull();
    expect(t.toolCalls).toEqual({});
    expect(t.finalMessage).toBeNull();
  });

  test("adapter metadata", () => {
    expect(claudeCode.name).toBe("claude-code");
    expect(claudeCode.envPassthrough).toContain("ANTHROPIC_API_KEY");
  });
});
