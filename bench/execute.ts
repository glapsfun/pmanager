import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Adapter, RunOutcome } from "./adapters/types";
import { installContract } from "./contract";
import { linkSkill } from "./fixture";
import { runCompleted } from "./graders/common";
import { buildCheckContext } from "./graders/context";
import { type CheckOutcome, isSuccess, runChecks, scoreByKind, scoreChecks } from "./graders/types";
import { hashFixture, hashString } from "./hashes";
import { type Condition, composePrompt, type Scenario } from "./scenarios/types";
import { SKILL_DIR } from "./skill-paths";

export type AttemptStatus = "completed" | "timeout" | "harness-error" | "setup-error";

export interface ExecuteRequest {
  adapter: Adapter;
  scenario: Scenario;
  condition: Condition;
  model: string | undefined;
  timeoutMs: number;
  env: Record<string, string>;
  extraArgs: string[] | ((fixtureDir: string) => string[]);
  rawLogPath: string;
  keep: boolean;
  expectedFixtureHash?: string;
  artifactsDir?: string;
}

export interface ExecuteResult {
  status: AttemptStatus;
  statusReason: string | null;
  fixtureDir: string;
  fixtureHash: string;
  promptHash: string;
  outcome: RunOutcome | null;
  checks: CheckOutcome[];
  score: number;
  outcomeScore: number | null;
  contractScore: number | null;
  success: boolean;
}

export function classify(outcome: RunOutcome, completion: CheckOutcome): AttemptStatus {
  if (outcome.timedOut) return "timeout";
  if (completion.passed !== true) return "harness-error";
  return "completed";
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeArtifacts(
  dir: string,
  fixtureDir: string,
  outcome: RunOutcome,
  stderr: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "final-message.md"), outcome.telemetry.finalMessage ?? "");
  await writeFile(join(dir, "stderr.txt"), stderr);
  const pm = join(fixtureDir, "docs", "pm");
  if (await exists(pm)) await cp(pm, join(dir, "docs-pm"), { recursive: true });
  else await writeFile(join(dir, "docs-pm.missing"), "");
}

function setupError(
  reason: string,
  base: Pick<ExecuteResult, "fixtureDir" | "fixtureHash" | "promptHash">,
): ExecuteResult {
  return {
    ...base,
    status: "setup-error",
    statusReason: reason,
    outcome: null,
    checks: [],
    score: 0,
    outcomeScore: null,
    contractScore: null,
    success: false,
  };
}

/** Builds a fixture, runs one harness attempt in it, grades the result, and cleans up. */
export async function executeScenario(req: ExecuteRequest): Promise<ExecuteResult> {
  const fixtureDir = await mkdtemp(join(tmpdir(), `pm-bench-${req.scenario.name}-`));
  let originBare: string | null = null;
  const prompt = composePrompt(req.scenario, req.condition);
  const promptHash = hashString(prompt);
  try {
    const info = await req.scenario.buildFixture(fixtureDir);
    originBare = info.originBare;
    await installContract(fixtureDir);
    const fixtureHash = await hashFixture(fixtureDir);
    if (req.expectedFixtureHash && req.expectedFixtureHash !== fixtureHash) {
      return setupError(
        `fixture hash ${fixtureHash} differs from manifest ${req.expectedFixtureHash}`,
        { fixtureDir, fixtureHash, promptHash },
      );
    }
    if (req.condition === "with-skill") await linkSkill(fixtureDir, SKILL_DIR);
    await mkdir(dirname(req.rawLogPath), { recursive: true });
    const extraArgs =
      typeof req.extraArgs === "function" ? req.extraArgs(fixtureDir) : req.extraArgs;
    const outcome = await req.adapter.run({
      cwd: fixtureDir,
      prompt,
      model: req.model,
      timeoutMs: req.timeoutMs,
      env: req.env,
      rawLogPath: req.rawLogPath,
      extraArgs,
    });
    const ctx = await buildCheckContext(fixtureDir, info, outcome.telemetry, {
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
    });
    const completion = (await runChecks([runCompleted], ctx))[0] as CheckOutcome;
    const status = classify(outcome, completion);
    const scenarioOutcomes = await runChecks(req.scenario.checks, ctx);
    const completed = status === "completed";
    const scored = scoreChecks(scenarioOutcomes);
    if (req.artifactsDir) {
      await writeArtifacts(req.artifactsDir, fixtureDir, outcome, outcome.stderr ?? "");
    }
    return {
      status,
      statusReason: completed ? null : completion.evidence,
      fixtureDir,
      fixtureHash,
      promptHash,
      outcome,
      checks: [completion, ...scenarioOutcomes],
      score: completed ? Number(scored.score.toFixed(4)) : 0,
      outcomeScore: completed ? scoreByKind(scenarioOutcomes, "outcome") : 0,
      contractScore: completed ? scoreByKind(scenarioOutcomes, "contract") : 0,
      success: completed && isSuccess(scenarioOutcomes),
    };
  } finally {
    if (!req.keep) {
      await rm(fixtureDir, { recursive: true, force: true });
      if (originBare) await rm(originBare, { recursive: true, force: true });
    }
  }
}
