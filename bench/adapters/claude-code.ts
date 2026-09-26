import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolCall } from "../boundary";
import { type TraceEvent, traceMetrics } from "../trace";
import { spawnWithTimeout } from "./spawn";
import {
  type Adapter,
  addCount,
  type Detection,
  EMPTY_TELEMETRY,
  type IsolateOptions,
  type Isolation,
  type Telemetry,
} from "./types";

type Json = Record<string, unknown>;

export function parseLines(jsonl: string): Json[] {
  const out: Json[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === "object") out.push(v as Json);
    } catch {
      // not a JSON line: harness noise, skip it
    }
  }
  return out;
}

async function versionOutput(bin: string, args: string[]): Promise<string | Detection> {
  try {
    const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return { available: false, reason: `${bin} ${args.join(" ")} exited ${code}` };
    return out.trim();
  } catch (e) {
    return { available: false, reason: `${bin} not found: ${(e as Error).message}` };
  }
}

export async function detectCli(bin: string, args: string[]): Promise<Detection> {
  const out = await versionOutput(bin, args);
  if (typeof out !== "string") return out;
  return { available: true, version: out.split(/\s+/)[0] ?? out };
}

export async function detectCliLastToken(bin: string, args: string[]): Promise<Detection> {
  const out = await versionOutput(bin, args);
  if (typeof out !== "string") return out;
  return { available: true, version: out.split(/\s+/).pop() ?? out };
}

function blocks(msg: Json | undefined): Json[] {
  const c = msg?.content;
  return Array.isArray(c) ? (c as Json[]) : [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function claudeCall(name: string, input: Json | undefined): ToolCall {
  const searchesCwd = name === "Grep" || name === "Glob" ? "." : undefined;
  return {
    tool: name,
    path: str(input?.file_path) ?? str(input?.notebook_path) ?? str(input?.path) ?? searchesCwd,
    command: str(input?.command),
  };
}

/** Characters of a tool result: a plain string, or the text blocks of a content array. */
export function textBytes(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    const text = b?.text;
    if (typeof text === "string") n += text.length;
  }
  return n;
}

function contextOf(u: Json): number {
  return (
    Number(u.input_tokens ?? 0) +
    Number(u.cache_read_input_tokens ?? 0) +
    Number(u.cache_creation_input_tokens ?? 0)
  );
}

export function parseClaudeStream(jsonl: string): Telemetry {
  const toolCalls: Record<string, number> = {};
  const commands: string[] = [];
  const t: Telemetry = { ...EMPTY_TELEMETRY, toolCalls, commands };
  const events: TraceEvent[] = [];
  const calls = new Set<string>();
  for (const ev of parseLines(jsonl)) {
    // subagent traffic names its parent tool call and never enters the main window
    const main = typeof ev.parent_tool_use_id !== "string";
    if (ev.type === "system" && ev.subtype === "init" && typeof ev.model === "string") {
      t.model = ev.model;
    } else if (ev.type === "assistant") {
      const msg = ev.message as Json | undefined;
      const usage = msg?.usage as Json | undefined;
      const id = str(msg?.id);
      // one API call streams one event per content block, all with the same id and usage
      if (main && usage && !(id && calls.has(id))) {
        if (id) calls.add(id);
        events.push({ kind: "call", context: contextOf(usage) });
      }
      for (const block of blocks(msg)) {
        if (block.type !== "tool_use") continue;
        const name = String(block.name ?? "unknown");
        addCount(toolCalls, name);
        const input = block.input as Json | undefined;
        if (name === "Bash" && typeof input?.command === "string") commands.push(input.command);
        if (main) events.push({ kind: "tool", ...claudeCall(name, input) });
      }
    } else if (ev.type === "user" && main) {
      for (const block of blocks(ev.message as Json | undefined)) {
        if (block.type === "tool_result") {
          events.push({ kind: "result", bytes: textBytes(block.content) });
        }
      }
    } else if (ev.type === "result") {
      const u = ev.usage as Json | undefined;
      if (u) {
        t.tokens = {
          input: Number(u.input_tokens ?? 0),
          output: Number(u.output_tokens ?? 0),
          cacheRead: Number(u.cache_read_input_tokens ?? 0),
          cacheWrite: Number(u.cache_creation_input_tokens ?? 0),
        };
      }
      if (typeof ev.total_cost_usd === "number") t.costUsd = ev.total_cost_usd;
      if (typeof ev.num_turns === "number") t.turns = ev.num_turns;
      if (typeof ev.result === "string") t.finalMessage = ev.result;
    }
  }
  t.trace = traceMetrics(events);
  return t;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** A config dir holding only the credentials file: no user skills, plugins, settings or memory. */
export async function isolateClaude(opts: IsolateOptions): Promise<Isolation | null> {
  const creds = join(opts.home, ".claude", ".credentials.json");
  const hasFile = await exists(creds);
  const env = opts.env ?? process.env;
  if (!hasFile && !env.ANTHROPIC_API_KEY) return null;
  const dir = await mkdtemp(join(opts.tmp, "claude-config-"));
  if (hasFile) await copyFile(creds, join(dir, ".credentials.json"));
  return {
    mode: "config-dir",
    env: { CLAUDE_CONFIG_DIR: dir },
    args: () => [],
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export const claudeCode: Adapter = {
  name: "claude-code",
  defaultModel: undefined,
  envPassthrough: ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_MAX_BUDGET_USD"],
  detect: () => detectCli("claude", ["--version"]),
  isolate: isolateClaude,
  async run(opts) {
    const cmd = [
      "claude",
      ...(opts.extraArgs ?? []),
      "-p",
      opts.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];
    if (opts.model) cmd.push("--model", opts.model);
    const budget = opts.env.CLAUDE_CODE_MAX_BUDGET_USD;
    if (budget) cmd.push("--max-budget-usd", budget);
    const r = await spawnWithTimeout(cmd, opts);
    return {
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
      telemetry: parseClaudeStream(r.stdout),
      rawLogPath: opts.rawLogPath,
      stderr: r.stderr,
    };
  },
};
