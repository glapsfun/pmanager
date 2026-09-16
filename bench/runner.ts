import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOk } from "../plugins/pmanager/skills/pmanager/scripts/git";
import type { Adapter } from "./adapters/types";
import { linkSkill } from "./fixture";
import { buildCheckContext } from "./graders/context";
import { runChecks, type Score, scoreChecks } from "./graders/types";
import { type AgentRunLine, appendHistory, stripTelemetry } from "./history";
import type { Scenario } from "./scenarios/types";
import { PM_TODAY, REPO_ROOT, SKILL_DIR } from "./skill-paths";

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
  const fixtureDir = await mkdtemp(join(tmpdir(), `pm-bench-${req.scenario.name}-`));
  const info = await req.scenario.buildFixture(fixtureDir);
  await linkSkill(fixtureDir, SKILL_DIR);
  await mkdir(req.rawDir, { recursive: true });
  const rawLogPath = join(
    req.rawDir,
    `${stamp()}-${req.adapter.name}-${req.scenario.name}-${req.run}.jsonl`,
  );
  const model = req.model ?? req.adapter.defaultModel;
  const outcome = await req.adapter.run({
    cwd: fixtureDir,
    prompt: req.scenario.prompt,
    model,
    timeoutMs: req.timeoutMs,
    env: buildEnv(req.adapter),
    rawLogPath,
  });
  const ctx = await buildCheckContext(fixtureDir, info, outcome.telemetry);
  const score = scoreChecks(await runChecks(req.scenario.checks, ctx));
  const line: AgentRunLine = {
    kind: "agent",
    date: new Date().toISOString(),
    sha: req.meta.sha,
    skillVersion: req.meta.skillVersion,
    harness: req.adapter.name,
    harnessVersion: req.meta.harnessVersion,
    model: model ?? null,
    scenario: req.scenario.name,
    run: req.run,
    score: Number(score.score.toFixed(4)),
    failed: score.failed,
    skipped: score.skipped,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
    exitCode: outcome.exitCode,
    telemetry: stripTelemetry(outcome.telemetry),
  };
  await appendHistory(req.historyPath, line);
  if (!req.keep) {
    await rm(fixtureDir, { recursive: true, force: true });
    if (info.originBare) await rm(info.originBare, { recursive: true, force: true });
  }
  return { line, score, fixtureDir, rawLogPath };
}
