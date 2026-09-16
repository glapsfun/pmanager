import { detectCliLastToken, parseLines } from "./claude-code";
import { spawnWithTimeout } from "./spawn";
import { type Adapter, addCount, EMPTY_TELEMETRY, type Telemetry } from "./types";

type Json = Record<string, unknown>;

const NOT_TOOLS = new Set(["agent_message", "reasoning", "error", "todo_list"]);

export function parseCodexStream(jsonl: string): Telemetry {
  const toolCalls: Record<string, number> = {};
  const commands: string[] = [];
  const t: Telemetry = { ...EMPTY_TELEMETRY, toolCalls, commands };
  let sawUsage = false;
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const ev of parseLines(jsonl)) {
    if (ev.type === "turn.completed") {
      const u = ev.usage as Json | undefined;
      if (!u) continue;
      sawUsage = true;
      sum.input += Number(u.input_tokens ?? 0);
      sum.output += Number(u.output_tokens ?? 0);
      sum.cacheRead += Number(u.cached_input_tokens ?? 0);
      sum.cacheWrite += Number(u.cache_write_input_tokens ?? 0);
    } else if (ev.type === "turn.failed") {
      t.finalMessage = null;
    } else if (ev.type === "item.completed") {
      const item = ev.item as Json | undefined;
      const kind = String(item?.type ?? "");
      if (!item || !kind) continue;
      if (kind === "agent_message" && typeof item.text === "string") t.finalMessage = item.text;
      if (NOT_TOOLS.has(kind)) continue;
      addCount(toolCalls, kind);
      if (kind === "command_execution" && typeof item.command === "string") {
        commands.push(item.command);
      }
    }
  }
  if (sawUsage) t.tokens = sum;
  return t;
}

export const codex: Adapter = {
  name: "codex",
  defaultModel: undefined,
  envPassthrough: ["OPENAI_API_KEY", "CODEX_HOME"],
  detect: () => detectCliLastToken("codex", ["--version"]),
  async run(opts) {
    const cmd = [
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      opts.cwd,
    ];
    if (opts.model) cmd.push("-m", opts.model);
    cmd.push(opts.prompt);
    const r = await spawnWithTimeout(cmd, opts);
    return {
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
      telemetry: parseCodexStream(r.stdout),
      rawLogPath: opts.rawLogPath,
    };
  },
};
