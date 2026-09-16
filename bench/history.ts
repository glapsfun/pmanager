import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HarnessName, Telemetry } from "./adapters/types";

export type StoredTelemetry = Omit<Telemetry, "finalMessage" | "commands">;

export interface AgentRunLine {
  kind: "agent";
  date: string;
  sha: string;
  skillVersion: string;
  harness: HarnessName;
  harnessVersion: string;
  model: string | null;
  scenario: string;
  run: number;
  score: number;
  failed: string[];
  skipped: string[];
  durationMs: number;
  timedOut: boolean;
  exitCode: number | null;
  telemetry: StoredTelemetry;
}

export interface Timing {
  median: number;
  max: number;
}

export interface ToolBenchLine {
  kind: "tool";
  date: string;
  sha: string;
  skillVersion: string;
  epics: number;
  tasks: number;
  iterations: number;
  statusMs: Timing;
  checkMs: Timing;
  renderMs: Timing;
}

export type HistoryLine = AgentRunLine | ToolBenchLine;

export function stripTelemetry(t: Telemetry): StoredTelemetry {
  return { tokens: t.tokens, costUsd: t.costUsd, turns: t.turns, toolCalls: t.toolCalls };
}

export async function readHistory(path: string): Promise<HistoryLine[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as HistoryLine);
}

export async function appendHistory(path: string, line: HistoryLine): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const existing = await readHistory(path);
  const tmp = `${path}.tmp`;
  const body = [...existing, line].map((l) => JSON.stringify(l)).join("\n");
  await writeFile(tmp, `${body}\n`);
  await rename(tmp, path);
}
