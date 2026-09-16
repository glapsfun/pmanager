import type { AttemptStatus } from "./execute";
import type { AttemptRecord, Manifest } from "./experiment";
import type { Condition } from "./scenarios/types";

export interface Quartiles {
  median: number;
  q1: number;
  q3: number;
  n: number;
}

export interface GroupStats {
  scenario: string;
  condition: Condition;
  planned: number;
  attempted: number;
  completed: number;
  failed: Record<AttemptStatus, number>;
  successRate: number | null;
  score: Quartiles | null;
  checkFailureRate: Record<string, number>;
  durationMs: Quartiles | null;
  tokens: {
    input: Quartiles | null;
    output: Quartiles | null;
    cacheRead: Quartiles | null;
    cacheWrite: Quartiles | null;
    /** input + cacheWrite per attempt: the prompt tokens the harness paid for fresh */
    fresh: Quartiles | null;
  };
  cost: { sumUsd: number | null; n: number };
}

export interface PairDiff {
  pair: number;
  scenario: string;
  scoreDiff: number;
  successDiff: number;
}

export interface ScenarioPairing {
  scenario: string;
  a: Condition;
  b: Condition;
  pairsCompleted: number;
  pairsExcluded: number;
  scoreDiff: Quartiles | null;
  successDiff: number | null;
  diffs: PairDiff[];
}

export interface ExperimentSummary {
  id: string;
  preliminary: boolean;
  noCostTelemetry: boolean;
  groups: GroupStats[];
  pairings: ScenarioPairing[];
  spendUsd: number | null;
}

const PRELIMINARY_BELOW = 10;

function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function quartiles(values: number[]): Quartiles | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  return {
    median: percentile(s, 0.5),
    q1: percentile(s, 0.25),
    q3: percentile(s, 0.75),
    n: s.length,
  };
}

function emptyFailed(): Record<AttemptStatus, number> {
  return { completed: 0, timeout: 0, "harness-error": 0, "setup-error": 0 };
}

type TokenKey = "input" | "output" | "cacheRead" | "cacheWrite";

function groupStats(
  m: Manifest,
  attempts: AttemptRecord[],
  scenario: string,
  condition: Condition,
): GroupStats {
  const planned = m.planned.filter((p) => p.scenario === scenario && p.condition === condition);
  const mine = attempts.filter((a) => a.scenario === scenario && a.condition === condition);
  const done = mine.filter((a) => a.status === "completed");
  const failed = emptyFailed();
  for (const a of mine) if (a.status !== "completed") failed[a.status]++;
  const checkFailureRate: Record<string, number> = {};
  if (done.length) {
    const ids = [
      ...new Set(
        done.flatMap((a) => a.checks.filter((c) => c.kind !== "diagnostic").map((c) => c.id)),
      ),
    ];
    for (const id of ids) {
      const failures = done.filter((a) => a.checks.some((c) => c.id === id && c.passed === false));
      checkFailureRate[id] = failures.length / done.length;
    }
  }
  const tok = (k: TokenKey) =>
    quartiles(done.filter((a) => a.telemetry.tokens).map((a) => a.telemetry.tokens?.[k] as number));
  const costs = mine
    .filter((a) => a.telemetry.costUsd !== null)
    .map((a) => a.telemetry.costUsd as number);
  return {
    scenario,
    condition,
    planned: planned.length,
    attempted: mine.length,
    completed: done.length,
    failed,
    successRate: mine.length ? mine.filter((a) => a.success).length / mine.length : null,
    score: quartiles(done.map((a) => a.score)),
    checkFailureRate,
    durationMs: quartiles(done.map((a) => a.durationMs)),
    tokens: {
      input: tok("input"),
      output: tok("output"),
      cacheRead: tok("cacheRead"),
      cacheWrite: tok("cacheWrite"),
      fresh: quartiles(
        done
          .filter((a) => a.telemetry.tokens)
          .map((a) => (a.telemetry.tokens?.input ?? 0) + (a.telemetry.tokens?.cacheWrite ?? 0)),
      ),
    },
    cost: { sumUsd: costs.length ? costs.reduce((x, y) => x + y, 0) : null, n: costs.length },
  };
}

function pairing(
  m: Manifest,
  attempts: AttemptRecord[],
  scenario: string,
  a: Condition,
  b: Condition,
): ScenarioPairing {
  const diffs: PairDiff[] = [];
  let excluded = 0;
  for (let pair = 1; pair <= m.pairs; pair++) {
    const find = (c: Condition) =>
      attempts.find((r) => r.pair === pair && r.scenario === scenario && r.condition === c);
    const x = find(a);
    const y = find(b);
    if (x?.status === "completed" && y?.status === "completed") {
      diffs.push({
        pair,
        scenario,
        scoreDiff: x.score - y.score,
        successDiff: Number(x.success) - Number(y.success),
      });
    } else {
      excluded++;
    }
  }
  return {
    scenario,
    a,
    b,
    pairsCompleted: diffs.length,
    pairsExcluded: excluded,
    scoreDiff: quartiles(diffs.map((d) => d.scoreDiff)),
    successDiff: diffs.length ? diffs.reduce((s, d) => s + d.successDiff, 0) / diffs.length : null,
    diffs,
  };
}

/** Per-experiment statistics; attempts are only ever compared within the experiment. */
export function aggregate(m: Manifest, attempts: AttemptRecord[]): ExperimentSummary {
  const groups = m.scenarios.flatMap((s) =>
    m.conditions.map((c) => groupStats(m, attempts, s.name, c)),
  );
  const [a, b] = m.conditions;
  const pairings = a && b ? m.scenarios.map((s) => pairing(m, attempts, s.name, a, b)) : [];
  const preliminary = pairings.length
    ? pairings.some((p) => p.pairsCompleted < PRELIMINARY_BELOW)
    : groups.some((g) => g.completed < PRELIMINARY_BELOW);
  const costs = attempts
    .filter((r) => r.telemetry.costUsd !== null)
    .map((r) => r.telemetry.costUsd as number);
  return {
    id: m.id,
    preliminary,
    noCostTelemetry: costs.length === 0,
    groups,
    pairings,
    spendUsd: costs.length ? costs.reduce((x, y) => x + y, 0) : null,
  };
}
