export type HarnessName = "claude-code" | "codex" | "pi" | "gemini-cli" | "copilot";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Telemetry {
  tokens: TokenUsage | null;
  costUsd: number | null;
  turns: number | null;
  toolCalls: Record<string, number> | null;
  commands: string[] | null;
  finalMessage: string | null;
  model: string | null;
}

export const EMPTY_TELEMETRY: Telemetry = {
  tokens: null,
  costUsd: null,
  turns: null,
  toolCalls: null,
  commands: null,
  finalMessage: null,
  model: null,
};

export interface Detection {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface RunOptions {
  cwd: string;
  prompt: string;
  model: string | undefined;
  timeoutMs: number;
  env: Record<string, string>;
  rawLogPath: string;
}

export interface RunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  telemetry: Telemetry;
  rawLogPath: string;
}

export interface Adapter {
  name: HarnessName;
  defaultModel: string | undefined;
  envPassthrough: string[];
  detect(): Promise<Detection>;
  run(opts: RunOptions): Promise<RunOutcome>;
}

export function addCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
