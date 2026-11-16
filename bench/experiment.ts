import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { git } from "../plugins/pmanager/skills/pmanager/scripts/git";
import { exists } from "./adapters/claude-code";
import { type Adapter, EMPTY_TELEMETRY, type HarnessName, type Isolation } from "./adapters/types";
import {
  type BaselineCopy,
  type BaselineInfo,
  baselineProblem,
  extractBaseline,
  hashProblem,
  resolveCommit,
} from "./baseline";
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
  baseline?: BaselineInfo;
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
  /** git ref whose committed skill the baseline-skill condition runs */
  baseline?: string;
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
  /** attempts run at once, each worker with its own isolation; 1 when absent */
  concurrency?: number;
}

/**
 * Why the account, not the attempt, failed: a usage limit or a login that can no longer renew.
 * Such an attempt is left unrecorded, so the next run resumes it.
 */
export function accountStop(text: string): string | null {
  if (/hit your [\w-]+ limit|usage limit|usage_limit_reached|rate_limit_error/i.test(text)) {
    return "the account's usage limit was reached";
  }
  if (
    /failed to authenticate|oauth session expired|invalid api key|please run \/login/i.test(text)
  ) {
    return "the harness login expired; sign in again";
  }
  return null;
}

const EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** An id names exactly one directory directly under the experiments root. */
export function experimentDir(experimentsDir: string, id: string): string {
  if (!EXPERIMENT_ID.test(id)) {
    throw new Error(
      `experiment id ${JSON.stringify(id)} must start with a letter or digit and use only letters, digits, ".", "_" or "-"`,
    );
  }
  const root = resolve(experimentsDir);
  const destination = resolve(root, id);
  const relativeDestination = relative(root, destination);
  if (
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${sep}`) ||
    isAbsolute(relativeDestination)
  ) {
    throw new Error(`experiment id ${JSON.stringify(id)} must stay under ${root}`);
  }
  return destination;
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
  const dir = experimentDir(deps.experimentsDir, opts.id);
  const destination = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (destination) {
    throw new Error(`experiment ${opts.id} already exists at ${dir}; pick a new id`);
  }
  if (opts.conditions.includes("baseline-skill") !== Boolean(opts.baseline)) {
    throw new Error(
      "the baseline-skill condition needs --baseline <git-ref>, and --baseline needs it",
    );
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
  let baseline: BaselineInfo | undefined;
  if (opts.baseline) {
    const sha = await resolveCommit(opts.baseline);
    const copy = await extractBaseline(sha);
    await copy.remove();
    baseline = { ref: opts.baseline, sha, skillHash: copy.hash };
  }
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
    ...(baseline ? { baseline } : {}),
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
  if (m.baseline) {
    const problem = await baselineProblem(m.baseline);
    if (problem) problems.push(problem);
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
): Promise<{ ran: number; remaining: number; stopped?: string }> {
  const m = await readManifest(dir);
  const problems = await validateManifest(m, deps.adapter);
  if (problems.length) {
    throw new Error(
      `experiment ${m.id} inputs changed since it was created:\n  ${problems.join("\n  ")}`,
    );
  }
  const todo = remaining(m, await readAttempts(dir));
  // Each worker has its own isolation: concurrent harness runs never share one config dir.
  const workers = Math.max(1, Math.min(deps.concurrency ?? 1, todo.length || 1));
  const tmps: string[] = [];
  const isos: (Isolation | null)[] = [];
  const cleanupAll = async () => {
    for (const iso of isos) await iso?.cleanup();
    for (const t of tmps) await rm(t, { recursive: true, force: true });
  };
  for (let i = 0; i < workers; i++) {
    const t = await mkdtemp(join(deps.tmp, "pm-bench-iso-"));
    tmps.push(t);
    isos.push(await deps.adapter.isolate({ home: deps.home, tmp: t, env: deps.env }));
  }
  if (m.conditions.length > 1 && isos.some((x) => !x)) {
    await cleanupAll();
    throw new Error("isolation unavailable; refusing a two-condition experiment");
  }
  let baseline: BaselineCopy | null = null;
  const reasoningArgs =
    m.reasoning && m.harness === "codex" ? ["-c", `model_reasoning_effort=${m.reasoning}`] : [];
  let ran = 0;
  let next = 0;
  let stopped: string | undefined;
  // The first error a worker throws; TypeScript does not see the workers assign it.
  const failures: unknown[] = [];
  // One process appends every record, in the order attempts finish.
  let writes = Promise.resolve();
  const record = (rec: AttemptRecord) => {
    writes = writes.then(() => appendAttempt(dir, rec));
    return writes;
  };

  const runOne = async (
    p: PlannedAttempt,
    iso: Isolation | null,
  ): Promise<AttemptRecord | null> => {
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
    await iso?.refresh?.();
    const startedAt = new Date().toISOString();
    const r = await executeScenario({
      adapter: deps.adapter,
      scenario,
      condition: p.condition,
      model: m.modelRequested,
      timeoutMs: m.timeoutS * 1000,
      env: { ...deps.env, ...(iso?.env ?? {}) },
      extraArgs: (fixtureDir) => [...reasoningArgs, ...(iso?.args(p.condition, fixtureDir) ?? [])],
      rawLogPath: join(artifactsDir, "raw.jsonl"),
      keep: false,
      expectedFixtureHash: entry.fixtureHash,
      artifactsDir,
      skillDir: p.condition === "baseline-skill" ? baseline?.dir : undefined,
    });
    if (r.status !== "completed") {
      const why = accountStop(
        `${r.outcome?.telemetry.finalMessage ?? ""}\n${r.outcome?.stderr ?? ""}`,
      );
      if (why) {
        stopped ??= why;
        await rm(artifactsDir, { recursive: true, force: true });
        return null;
      }
    }
    const resolved = r.outcome?.telemetry.model ?? null;
    const mismatch = resolved !== null && resolved !== m.modelRequested;
    return {
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
  };

  const worker = async (iso: Isolation | null) => {
    while (!stopped && failures.length === 0) {
      const p = todo[next++];
      if (!p) return;
      try {
        const rec = await runOne(p, iso);
        if (!rec) return;
        await record(rec);
        deps.onAttempt?.(rec);
        ran++;
      } catch (error) {
        failures.push(error);
        return;
      }
    }
  };

  try {
    if (m.baseline) {
      baseline = await extractBaseline(m.baseline.sha, deps.tmp);
      const problem = hashProblem(m.baseline, baseline.hash);
      if (problem) throw new Error(problem);
    }
    await Promise.all(isos.map(worker));
  } finally {
    await writes;
    await baseline?.remove();
    await cleanupAll();
  }
  if (failures.length > 0) throw failures[0];
  return { ran, remaining: todo.length - ran, ...(stopped ? { stopped } : {}) };
}
