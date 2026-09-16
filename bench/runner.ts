import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gitOk } from "../plugins/pmanager/skills/pmanager/scripts/git";
import { type Adapter, EMPTY_TELEMETRY } from "./adapters/types";
import { executeScenario } from "./execute";
import type { Score } from "./graders/types";
import { type AgentRunLine, appendHistory, stripTelemetry } from "./history";
import type { Scenario } from "./scenarios/types";
import { PM_TODAY, REPO_ROOT } from "./skill-paths";

export interface RunMeta {
  sha: string;
  skillVersion: string;
  harnessVersion: string;
}

export interface RunRequest {
  adapter: Adapter;
  scenario: Scenario;
  model: string | undefined;
  timeoutMs: number;
  keep: boolean;
  run: number;
  historyPath: string;
  rawDir: string;
  meta: RunMeta;
}

export interface RunResult {
  line: AgentRunLine;
  score: Score;
  fixtureDir: string;
  rawLogPath: string;
}

const BASE_ENV = ["PATH", "HOME", "LANG", "TERM", "TMPDIR"];

export function buildEnv(
  adapter: Adapter,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = { PM_TODAY };
  for (const k of [...BASE_ENV, ...adapter.envPassthrough]) {
    const v = source[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export async function repoSha(): Promise<string> {
  return (await gitOk(["rev-parse", "--short", "HEAD"], REPO_ROOT)).trim();
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runScenario(req: RunRequest): Promise<RunResult> {
  await mkdir(req.rawDir, { recursive: true });
  const rawLogPath = join(
    req.rawDir,
    `${stamp()}-${req.adapter.name}-${req.scenario.name}-${req.run}.jsonl`,
  );
  const requested = req.model ?? req.adapter.defaultModel;
  const r = await executeScenario({
    adapter: req.adapter,
    scenario: req.scenario,
    condition: "with-skill",
    model: requested,
    timeoutMs: req.timeoutMs,
    env: buildEnv(req.adapter),
    extraArgs: [],
    rawLogPath,
    keep: req.keep,
  });
  const failed = r.checks.filter((c) => c.passed === false).map((c) => c.id);
  const skipped = r.checks.filter((c) => c.passed === null).map((c) => c.id);
  const line: AgentRunLine = {
    kind: "agent",
    date: new Date().toISOString(),
    sha: req.meta.sha,
    skillVersion: req.meta.skillVersion,
    harness: req.adapter.name,
    harnessVersion: req.meta.harnessVersion,
    model: requested ?? r.outcome?.telemetry.model ?? null,
    scenario: req.scenario.name,
    run: req.run,
    score: r.score,
    failed,
    skipped,
    durationMs: r.outcome?.durationMs ?? 0,
    timedOut: r.outcome?.timedOut ?? false,
    exitCode: r.outcome?.exitCode ?? null,
    telemetry: stripTelemetry(r.outcome?.telemetry ?? EMPTY_TELEMETRY),
  };
  await appendHistory(req.historyPath, line);
  const score: Score = { score: r.score, failed, skipped, outcomes: r.checks };
  return { line, score, fixtureDir: r.fixtureDir, rawLogPath };
}
