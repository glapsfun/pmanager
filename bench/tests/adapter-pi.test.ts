import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePiStream, pi } from "../adapters/pi";

describe("pi adapter", () => {
  test("sums assistant usage and cost, counts tool executions, keeps bash commands and last text", async () => {
    const raw = await readFile(join(import.meta.dir, "samples", "pi.jsonl"), "utf8");
    const t = parsePiStream(raw);
    expect(t.tokens).toEqual({ input: 2600, output: 220, cacheRead: 1500, cacheWrite: 200 });
    expect(t.costUsd).toBeCloseTo(0.019, 6);
    expect(t.turns).toBe(3);
    expect(t.toolCalls).toEqual({ bash: 1, read: 1 });
    expect(t.commands).toEqual([
      "bun run .agents/skills/pmanager/scripts/pm.ts status --harness pi",
    ]);
    expect(t.finalMessage).toBe("Draft epic committed; awaiting approval.");
  });

  test("no assistant messages yields nulls", () => {
    const t = parsePiStream('{"type":"agent_start"}\n');
    expect(t.tokens).toBeNull();
    expect(t.costUsd).toBeNull();
    expect(t.turns).toBeNull();
  });

  test("adapter metadata", () => {
    expect(pi.name).toBe("pi");
    expect(pi.envPassthrough).toEqual(
      expect.arrayContaining(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]),
    );
  });
});
