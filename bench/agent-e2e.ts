import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { adapterByName } from "./adapters/registry";
import type { Adapter, Detection, HarnessName } from "./adapters/types";
import type { Io } from "./bench";
import type { ParsedArgs } from "./cli-args";
import { isSuccess } from "./graders/types";
import { writeReport } from "./report";
import { repoSha, runScenario } from "./runner";
import { SCENARIOS } from "./scenarios/registry";
import {
  EXPERIMENTS_DIR,
  HISTORY_PATH,
  RAW_DIR,
  README_PATH,
  REPORT_PATH,
  readSkillVersion,
} from "./skill-paths";

export interface AgentHarnessConfig {
  name: HarnessName;
  model: string;
  blocking: boolean;
  maxBudgetUsd?: number;
}

export interface AgentE2eConfig {
  runs: number;
  need: number;
  harnesses: AgentHarnessConfig[];
}

export interface AgentRunResult {
  harness: string;
  scenario: string;
  success: boolean;
}

export interface AgentRow {
  harness: string;
  scenario: string;
  successes: number;
  runs: number;
  passed: boolean;
  blocking: boolean;
}

export interface AgentVerdict {
  pass: boolean;
  rows: AgentRow[];
  unavailable: { harness: string; blocking: boolean }[];
}

export const DEFAULT_CONFIG_PATH = join(import.meta.dir, "agent-e2e.json");

/** Scores each harness and scenario against `need` successes out of `runs`; only blocking harnesses decide. */
export function agentVerdict(
  results: AgentRunResult[],
  cfg: AgentE2eConfig,
  unavailable: string[],
): AgentVerdict {
  const rows: AgentRow[] = [];
  for (const h of cfg.harnesses) {
    if (unavailable.includes(h.name)) continue;
    for (const s of SCENARIOS) {
      const mine = results.filter((r) => r.harness === h.name && r.scenario === s.name);
      const successes = mine.filter((r) => r.success).length;
      rows.push({
        harness: h.name,
        scenario: s.name,
        successes,
        runs: cfg.runs,
        passed: successes >= cfg.need,
        blocking: h.blocking,
      });
    }
  }
  const missing = cfg.harnesses
    .filter((h) => unavailable.includes(h.name))
    .map((h) => ({ harness: h.name, blocking: h.blocking }));
  const pass = rows.every((r) => r.passed || !r.blocking) && missing.every((u) => !u.blocking);
  return { pass, rows, unavailable: missing };
}

/** One line per row, unavailable harnesses, then the overall result. */
export function formatVerdict(v: AgentVerdict): string {
  const lines = v.rows.map(
    (r) =>
      `${r.harness} ${r.scenario} ${r.successes}/${r.runs} ${r.passed ? "PASS" : "FAIL"}${r.blocking ? "" : " [report-only]"}`,
  );
  for (const u of v.unavailable) {
    lines.push(`${u.harness} unavailable${u.blocking ? "" : " [report-only]"}`);
  }
  lines.push(`agent e2e: ${v.pass ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

export async function loadConfig(path: string): Promise<AgentE2eConfig> {
  const cfg = JSON.parse(await readFile(path, "utf8")) as AgentE2eConfig;
  const ok =
    Number.isInteger(cfg.runs) &&
    Number.isInteger(cfg.need) &&
    cfg.need >= 1 &&
    cfg.need <= cfg.runs &&
    Array.isArray(cfg.harnesses) &&
    cfg.harnesses.length > 0 &&
    cfg.harnesses.every((h) => adapterByName(h.name) && h.model);
  if (!ok) throw new Error(`invalid agent e2e config: ${path}`);
  return cfg;
}

export interface AgentE2eDeps {
  adapterFor(name: string): Adapter | undefined;
  run: typeof runScenario;
}

const REAL_DEPS: AgentE2eDeps = { adapterFor: adapterByName, run: runScenario };

/** Paid: runs every scenario `runs` times per configured harness and exits 0 on pass, 1 on fail, 2 on usage. */
export async function cmdAgentE2e(
  a: ParsedArgs,
  io: Io,
  deps: AgentE2eDeps = REAL_DEPS,
): Promise<number> {
  const prior = process.env.CLAUDE_CODE_MAX_BUDGET_USD;
  try {
    return await runAll(a, io, deps);
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_CODE_MAX_BUDGET_USD;
    else process.env.CLAUDE_CODE_MAX_BUDGET_USD = prior;
  }
}

async function runAll(a: ParsedArgs, io: Io, deps: AgentE2eDeps): Promise<number> {
  let cfg: AgentE2eConfig;
  try {
    cfg = await loadConfig(a.configPath ?? DEFAULT_CONFIG_PATH);
  } catch (e) {
    io.err(`${(e as Error).message}\n`);
    return 2;
  }
  const historyPath = a.historyPath ?? HISTORY_PATH;
  const results: AgentRunResult[] = [];
  const unavailable: string[] = [];
  const sha = await repoSha();
  const skillVersion = await readSkillVersion();
  for (const h of cfg.harnesses) {
    const adapter = deps.adapterFor(h.name);
    let d: Detection = { available: false, reason: "no adapter" };
    if (adapter) {
      try {
        d = await adapter.detect();
      } catch (e) {
        d = { available: false, reason: (e as Error).message };
      }
    }
    if (!adapter || !d.available) {
      io.err(`${h.name} unavailable: ${d.reason ?? "unknown"}\n`);
      unavailable.push(h.name);
      continue;
    }
    const budget = a.maxBudgetUsd ?? h.maxBudgetUsd;
    if (h.name === "claude-code" && budget !== undefined) {
      process.env.CLAUDE_CODE_MAX_BUDGET_USD = String(budget);
    }
    const meta = { sha, skillVersion, harnessVersion: d.version ?? "unknown" };
    for (const scenario of SCENARIOS) {
      for (let run = 1; run <= cfg.runs; run++) {
        io.out(`> ${h.name} ${scenario.name} run ${run}/${cfg.runs}\n`);
        let success = false;
        try {
          const r = await deps.run({
            adapter,
            scenario,
            model: h.model,
            timeoutMs: a.timeoutS * 1000,
            keep: false,
            run,
            historyPath,
            rawDir: a.rawDir ?? RAW_DIR,
            meta,
          });
          success = !r.line.timedOut && isSuccess(r.score.outcomes);
        } catch (e) {
          io.err(`${h.name} ${scenario.name} run ${run} threw: ${(e as Error).message}\n`);
        }
        results.push({ harness: h.name, scenario: scenario.name, success });
        io.out(`  ${success ? "success" : "not a success"}\n`);
      }
    }
  }
  await writeReport(
    historyPath,
    a.reportPath ?? REPORT_PATH,
    a.historyPath === undefined && a.reportPath === undefined ? README_PATH : undefined,
    a.experimentsDir ?? EXPERIMENTS_DIR,
  );
  const v = agentVerdict(results, cfg, unavailable);
  io.out(formatVerdict(v));
  return v.pass ? 0 : 1;
}
