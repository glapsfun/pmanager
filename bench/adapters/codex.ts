import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { detectCliLastToken, exists, parseLines } from "./claude-code";
import { spawnWithTimeout } from "./spawn";
import {
  type Adapter,
  addCount,
  EMPTY_TELEMETRY,
  type IsolateOptions,
  type Isolation,
  type Telemetry,
} from "./types";

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
      // OpenAI counts cached tokens inside input_tokens; Anthropic reports them separately.
      // Store the uncached part so "input" means the same thing for every harness.
      const cached = Number(u.cached_input_tokens ?? 0);
      sum.input += Math.max(0, Number(u.input_tokens ?? 0) - cached);
      sum.output += Number(u.output_tokens ?? 0);
      sum.cacheRead += cached;
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

/** A temporary HOME and CODEX_HOME seeded with auth.json only: no user skills, memories or hooks. */
export async function isolateCodex(opts: IsolateOptions): Promise<Isolation | null> {
  const auth = join(opts.home, ".codex", "auth.json");
  const hasFile = await exists(auth);
  const env = opts.env ?? process.env;
  if (!hasFile && !env.OPENAI_API_KEY) return null;
  const home = await mkdtemp(join(opts.tmp, "codex-home-"));
  const codexHome = join(home, ".codex");
  await mkdir(codexHome, { recursive: true });
  if (hasFile) await copyFile(auth, join(codexHome, "auth.json"));
  return {
    mode: "home-dir",
    env: { HOME: home, CODEX_HOME: codexHome },
    args: () => [],
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

export const codex: Adapter = {
  name: "codex",
  defaultModel: undefined,
  envPassthrough: ["OPENAI_API_KEY", "CODEX_HOME"],
  detect: () => detectCliLastToken("codex", ["--version"]),
  isolate: isolateCodex,
  async run(opts) {
    const cmd = [
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      ...(opts.extraArgs ?? []),
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
      stderr: r.stderr,
    };
  },
};
