import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../plugins/pmanager/skills/pmanager/scripts/git";
import { exists } from "./adapters/claude-code";
import { type Adapter, EMPTY_TELEMETRY, type HarnessName } from "./adapters/types";
import { installContract, renderContract } from "./contract";
import { type AttemptStatus, executeScenario } from "./execute";
import { cleanupFixture } from "./fixture";
import type { CheckOutcome } from "./graders/types";
import { hashFixture, hashSkill, hashString } from "./hashes";
import { type HistoryLine, type StoredTelemetry, stripTelemetry } from "./history";
import { scenarioByName } from "./scenarios/registry";
import { type Condition, composePrompt, type Scenario } from "./scenarios/types";
import { REPO_ROOT, readSkillVersion } from "./skill-paths";

export interface ScenarioEntry {
  name: string;
  version: number;
  promptHash: string;
  fixtureHash: string;
  graderVersion: number;
}

export interface PlannedAttempt {
  attemptId: string;
  pair: number;
  scenario: string;
  condition: Condition;
  order: number;
}

export interface Manifest {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  harness: HarnessName;
  harnessVersion: string;
  modelRequested: string;
  reasoning: string | null;
  conditions: Condition[];
  pairs: number;
  timeoutS: number;
  repoSha: string;
  repoDirty: boolean;
  skillVersion: string;
  skillHash: string;
  contractHash: string;
  isolation: string | null;
  scenarios: ScenarioEntry[];
  planned: PlannedAttempt[];
}

export interface AttemptRecord {
  attemptId: string;
  pair: number;
  scenario: string;
  condition: Condition;
  order: number;
  status: AttemptStatus;
  statusReason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  modelRequested: string;
  modelResolved: string | null;
  score: number;
  outcomeScore: number | null;
  contractScore: number | null;
  success: boolean;
  checks: CheckOutcome[];
  telemetry: StoredTelemetry;
  artifactsDir: string;
}

export interface NewExperimentOptions {
  id: string;
  harness: HarnessName;
  model: string;
  reasoning?: string;
  conditions: Condition[];
  pairs: number;
  scenarios: string[];
  timeoutS: number;
}

export interface CreateDeps {
  adapter: Adapter;
  experimentsDir: string;
  repoSha(): Promise<string>;
  repoDirty(): Promise<boolean>;
}

export interface RunDeps {
  adapter: Adapter;
  env: Record<string, string>;
  home: string;
  tmp: string;
  onAttempt?: (rec: AttemptRecord) => void;
}

export function attemptId(
  id: string,
  pair: number,
  scenario: string,
  condition: Condition,
): string {
  return `${id}-p${pair}-${scenario}-${condition}`;
}

/** Odd pairs run the conditions as listed; even pairs run them reversed. */
export function planAttempts(
  id: string,
  scenarios: string[],
  conditions: Condition[],
  pairs: number,
): PlannedAttempt[] {
  const out: PlannedAttempt[] = [];
  for (let pair = 1; pair <= pairs; pair++) {
    const order = pair % 2 === 1 ? conditions : [...conditions].reverse();
    for (const scenario of scenarios) {
      order.forEach((condition, i) => {
        out.push({
          attemptId: attemptId(id, pair, scenario, condition),
          pair,
          scenario,
          condition,
          order: i + 1,
        });
      });
    }
  }
  return out;
}

async function scenarioEntry(s: Scenario): Promise<ScenarioEntry> {
  const dir = await mkdtemp(join(tmpdir(), `pm-bench-hash-${s.name}-`));
  let originBare: string | null = null;
  try {
    const info = await s.buildFixture(dir);
    originBare = info.originBare;
    await installContract(dir);
    return {
      name: s.name,
      version: 1,
      promptHash: hashString(composePrompt(s, "with-skill")),
      fixtureHash: await hashFixture(dir),
      graderVersion: s.graderVersion,
    };
  } finally {
    await cleanupFixture(dir);
    if (originBare) await rm(originBare, { recursive: true, force: true });
  }
}

export async function repoDirty(): Promise<boolean> {
  const r = await git(["status", "--porcelain"], REPO_ROOT);
  return r.stdout.trim() !== "";
}

export async function createExperiment(
  opts: NewExperimentOptions,
  deps: CreateDeps,
): Promise<Manifest> {
  const dir = join(deps.experimentsDir, opts.id);
  if (await exists(join(dir, "manifest.json"))) {
    throw new Error(`experiment ${opts.id} already exists at ${dir}; pick a new id`);
  }
  const scenarios = opts.scenarios.map((n) => {
    const s = scenarioByName(n);
    if (!s) throw new Error(`unknown scenario: ${n}`);
    return s;
  });
  const d = await deps.adapter.detect();
  if (!d.available) throw new Error(`${deps.adapter.name} unavailable: ${d.reason ?? "unknown"}`);
  const tmp = await mkdtemp(join(tmpdir(), "pm-bench-iso-"));
  const iso = await deps.adapter.isolate({ home: process.env.HOME ?? "", tmp });
  await iso?.cleanup();
  await rm(tmp, { recursive: true, force: true });
  if (opts.conditions.length > 1 && !iso) {
    throw new Error(
      `${deps.adapter.name} cannot establish isolation; a two-condition experiment is refused`,
    );
  }
  const entries: ScenarioEntry[] = [];
  for (const s of scenarios) entries.push(await scenarioEntry(s));
  const manifest: Manifest = {
    schemaVersion: 1,
    id: opts.id,
    createdAt: new Date().toISOString(),
    harness: deps.adapter.name,
    harnessVersion: d.version ?? "unknown",
    modelRequested: opts.model,
    reasoning: opts.reasoning ?? null,
    conditions: opts.conditions,
    pairs: opts.pairs,
    timeoutS: opts.timeoutS,
    repoSha: await deps.repoSha(),
    repoDirty: await deps.repoDirty(),
    skillVersion: await readSkillVersion(),
    skillHash: await hashSkill(),
    contractHash: hashString(renderContract()),
    isolation: iso?.mode ?? null,
    scenarios: entries,
    planned: planAttempts(opts.id, opts.scenarios, opts.conditions, opts.pairs),
  };
  await mkdir(dir, { recursive: true });
  // "wx" fails if the file appeared meanwhile, so two concurrent creations cannot both win.
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return manifest;
}

export async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifest;
}

/** A missing file is an empty history; a malformed line is an error, never silently dropped. */
export async function readAttempts(dir: string): Promise<AttemptRecord[]> {
  const path = join(dir, "attempts.jsonl");
  if (!(await exists(path))) return [];
  const out: AttemptRecord[] = [];
  const lines = (await readFile(path, "utf8")).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as AttemptRecord);
    } catch {
      throw new Error(`${path}: malformed JSON on line ${i + 1}`);
    }
  }
  return out;
}

/** Everything the manifest pinned must still hold before more attempts join the same experiment. */
export async function validateManifest(m: Manifest, adapter: Adapter): Promise<string[]> {
  const problems: string[] = [];
  const d = await adapter.detect();
  const version = d.version ?? "unknown";
  if (!d.available) problems.push(`${adapter.name} unavailable: ${d.reason ?? "unknown"}`);
  else if (version !== m.harnessVersion) {
    problems.push(`harness version ${version} differs from manifest ${m.harnessVersion}`);
  }
  const skillHash = await hashSkill();
  if (skillHash !== m.skillHash)
    problems.push(`skill hash ${skillHash} differs from manifest ${m.skillHash}`);
  const contractHash = hashString(renderContract());
  if (contractHash !== m.contractHash) problems.push("contract hash differs from manifest");
  for (const entry of m.scenarios) {
    const s = scenarioByName(entry.name);
    if (!s) {
      problems.push(`scenario ${entry.name} no longer exists`);
      continue;
    }
    const promptHash = hashString(composePrompt(s, "with-skill"));
    if (promptHash !== entry.promptHash)
      problems.push(`prompt of ${entry.name} differs from manifest`);
    if (s.graderVersion !== entry.graderVersion) {
      problems.push(
        `grader version of ${entry.name} is ${s.graderVersion}, manifest has ${entry.graderVersion}`,
      );
    }
  }
  return problems;
}

export async function appendAttempt(dir: string, rec: AttemptRecord): Promise<void> {
  const path = join(dir, "attempts.jsonl");
  const existing = await readAttempts(dir);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${[...existing, rec].map((r) => JSON.stringify(r)).join("\n")}\n`);
  await rename(tmp, path);
}

export function remaining(m: Manifest, done: AttemptRecord[]): PlannedAttempt[] {
  const seen = new Set(done.map((d) => d.attemptId));
  return m.planned.filter((p) => !seen.has(p.attemptId));
}

/** Mean cost of the harness's ad-hoc runs with cost telemetry, times the attempts left; null without cost data. */
export function estimateCost(
  m: Manifest,
  history: HistoryLine[],
  remainingCount = m.planned.length,
): number | null {
  const costs = history
    .filter((l): l is Extract<HistoryLine, { kind: "agent" }> => l.kind === "agent")
    .filter((l) => l.harness === m.harness && l.telemetry.costUsd !== null)
    .map((l) => l.telemetry.costUsd as number);
  if (costs.length === 0) return null;
  return (costs.reduce((a, b) => a + b, 0) / costs.length) * remainingCount;
}

export async function runExperiment(
  dir: string,
  deps: RunDeps,
): Promise<{ ran: number; remaining: number }> {
  const m = await readManifest(dir);
  const problems = await validateManifest(m, deps.adapter);
  if (problems.length) {
    throw new Error(
      `experiment ${m.id} inputs changed since it was created:\n  ${problems.join("\n  ")}`,
    );
  }
  const todo = remaining(m, await readAttempts(dir));
  const isoTmp = await mkdtemp(join(deps.tmp, "pm-bench-iso-"));
  const iso = await deps.adapter.isolate({ home: deps.home, tmp: isoTmp, env: deps.env });
  if (m.conditions.length > 1 && !iso) {
    await rm(isoTmp, { recursive: true, force: true });
    throw new Error("isolation unavailable; refusing a two-condition experiment");
  }
  const reasoningArgs =
    m.reasoning && m.harness === "codex" ? ["-c", `model_reasoning_effort=${m.reasoning}`] : [];
  let ran = 0;
  try {
    for (const p of todo) {
      const scenario = scenarioByName(p.scenario);
      const entry = m.scenarios.find((s) => s.name === p.scenario);
      if (!scenario || !entry) throw new Error(`manifest names unknown scenario ${p.scenario}`);
      if (!(await exists(join(dir, "manifest.json")))) {
        throw new Error(
          `${dir} was removed while the experiment was running; ${ran} attempt(s) of this run are recorded only in the console`,
        );
      }
      const artifactsDir = join(dir, "artifacts", p.attemptId);
      await mkdir(artifactsDir, { recursive: true });
      const startedAt = new Date().toISOString();
      const r = await executeScenario({
        adapter: deps.adapter,
        scenario,
        condition: p.condition,
        model: m.modelRequested,
        timeoutMs: m.timeoutS * 1000,
        env: { ...deps.env, ...(iso?.env ?? {}) },
        extraArgs: (fixtureDir) => [
          ...reasoningArgs,
          ...(iso?.args(p.condition, fixtureDir) ?? []),
        ],
        rawLogPath: join(artifactsDir, "raw.jsonl"),
        keep: false,
        expectedFixtureHash: entry.fixtureHash,
        artifactsDir,
      });
      const resolved = r.outcome?.telemetry.model ?? null;
      const mismatch = resolved !== null && resolved !== m.modelRequested;
      const rec: AttemptRecord = {
        ...p,
        status: mismatch ? "setup-error" : r.status,
        statusReason: mismatch
          ? `resolved model ${resolved} differs from requested ${m.modelRequested}`
          : r.statusReason,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: r.outcome?.durationMs ?? 0,
        exitCode: r.outcome?.exitCode ?? null,
        timedOut: r.outcome?.timedOut ?? false,
        modelRequested: m.modelRequested,
        modelResolved: resolved,
        score: mismatch ? 0 : r.score,
        outcomeScore: mismatch ? 0 : r.outcomeScore,
        contractScore: mismatch ? 0 : r.contractScore,
        success: mismatch ? false : r.success,
        checks: r.checks,
        telemetry: stripTelemetry(r.outcome?.telemetry ?? EMPTY_TELEMETRY),
        artifactsDir: join("artifacts", p.attemptId),
      };
      await appendAttempt(dir, rec);
      deps.onAttempt?.(rec);
      ran++;
    }
  } finally {
    await iso?.cleanup();
    await rm(isoTmp, { recursive: true, force: true });
  }
  return { ran, remaining: todo.length - ran };
}
