import { claudeCode } from "./claude-code";
import { codex } from "./codex";
import { copilot } from "./copilot";
import { geminiCli } from "./gemini-cli";
import { pi } from "./pi";
import type { Adapter, HarnessName } from "./types";

export const ADAPTERS: Adapter[] = [claudeCode, codex, pi, geminiCli, copilot];
export const HARNESS_NAMES: HarnessName[] = ADAPTERS.map((a) => a.name);

export function adapterByName(name: string): Adapter | undefined {
  return ADAPTERS.find((a) => a.name === name);
}
