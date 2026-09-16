import { detectCli, parseLines } from "./claude-code";
import { spawnWithTimeout } from "./spawn";
import { type Adapter, addCount, EMPTY_TELEMETRY, type Telemetry } from "./types";

type Json = Record<string, unknown>;

export function parsePiStream(jsonl: string): Telemetry {
  const toolCalls: Record<string, number> = {};
  const commands: string[] = [];
  const t: Telemetry = { ...EMPTY_TELEMETRY, toolCalls, commands };
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  let turns = 0;
  for (const ev of parseLines(jsonl)) {
    if (ev.type === "message_end") {
      const msg = ev.message as Json | undefined;
      if (msg?.role !== "assistant") continue;
      turns++;
      const u = msg.usage as Json | undefined;
      if (u) {
        sum.input += Number(u.input ?? 0);
        sum.output += Number(u.output ?? 0);
        sum.cacheRead += Number(u.cacheRead ?? 0);
        sum.cacheWrite += Number(u.cacheWrite ?? 0);
        const c = u.cost as Json | undefined;
        cost += Number(c?.total ?? 0);
      }
      for (const block of (msg.content as Json[] | undefined) ?? []) {
        if (block.type === "text" && typeof block.text === "string") t.finalMessage = block.text;
        if (block.type === "toolCall" && block.name === "bash") {
          const args = block.arguments as Json | undefined;
          if (typeof args?.command === "string") commands.push(args.command);
        }
      }
    } else if (ev.type === "tool_execution_end") {
      addCount(toolCalls, String(ev.toolName ?? "unknown"));
    }
  }
  if (turns > 0) {
    t.tokens = sum;
    t.costUsd = cost;
    t.turns = turns;
  }
  return t;
}

export const pi: Adapter = {
  name: "pi",
  defaultModel: undefined,
  envPassthrough: [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "PI_OFFLINE",
  ],
  detect: () => detectCli("pi", ["--version"]),
  async run(opts) {
    const cmd = ["pi", "-p", "--mode", "json", "--no-session"];
    if (opts.model) cmd.push("--model", opts.model);
    cmd.push(opts.prompt);
    const r = await spawnWithTimeout(cmd, opts);
    return {
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
      telemetry: parsePiStream(r.stdout),
      rawLogPath: opts.rawLogPath,
    };
  },
};
