import type { AttemptRecord, Manifest } from "../../experiment";
import type { CheckOutcome } from "../../graders/types";

export const manifest: Manifest = {
  schemaVersion: 1,
  id: "t",
  createdAt: "2026-09-16T00:00:00Z",
  harness: "claude-code",
  harnessVersion: "9",
  modelRequested: "m",
  reasoning: null,
  conditions: ["with-skill", "without-skill"],
  pairs: 3,
  timeoutS: 10,
  repoSha: "abc",
  repoDirty: false,
  skillVersion: "0.2.0",
  skillHash: "sha256:s",
  contractHash: "sha256:c",
  isolation: "fake",
  scenarios: [
    { name: "s", version: 1, promptHash: "sha256:p", fixtureHash: "sha256:f", graderVersion: 1 },
  ],
  planned: [1, 2, 3].flatMap((pair) =>
    (["with-skill", "without-skill"] as const).map((condition, i) => ({
      attemptId: `t-p${pair}-s-${condition}`,
      pair,
      scenario: "s",
      condition,
      order: i + 1,
    })),
  ),
};

const passing: CheckOutcome[] = [
  { id: "run-completed", kind: "diagnostic", passed: true, evidence: "" },
  { id: "o1", kind: "outcome", passed: true, evidence: "" },
  { id: "c1", kind: "contract", passed: true, evidence: "" },
];

export function rec(
  pair: number,
  condition: "with-skill" | "without-skill",
  over: Partial<AttemptRecord>,
): AttemptRecord {
  return {
    attemptId: `t-p${pair}-s-${condition}`,
    pair,
    scenario: "s",
    condition,
    order: 1,
    status: "completed",
    statusReason: null,
    startedAt: "",
    finishedAt: "",
    durationMs: 100,
    exitCode: 0,
    timedOut: false,
    modelRequested: "m",
    modelResolved: "m",
    score: 1,
    outcomeScore: 1,
    contractScore: 1,
    success: true,
    checks: passing,
    telemetry: {
      tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      costUsd: 1,
      turns: 1,
      toolCalls: {},
    },
    artifactsDir: "artifacts/x",
    ...over,
  };
}

export const failedO1: Partial<AttemptRecord> = {
  score: 0.5,
  outcomeScore: 0,
  contractScore: 1,
  success: false,
  checks: [
    { id: "run-completed", kind: "diagnostic", passed: true, evidence: "" },
    { id: "o1", kind: "outcome", passed: false, evidence: "" },
    { id: "c1", kind: "contract", passed: true, evidence: "" },
  ],
};

export const attempts: AttemptRecord[] = [
  rec(1, "with-skill", { durationMs: 100 }),
  rec(1, "without-skill", { ...failedO1, durationMs: 300 }),
  rec(2, "with-skill", {
    durationMs: 200,
    telemetry: { tokens: null, costUsd: null, turns: null, toolCalls: null },
  }),
  rec(2, "without-skill", {
    status: "timeout",
    statusReason: "timed out",
    score: 0,
    outcomeScore: 0,
    contractScore: 0,
    success: false,
    timedOut: true,
    exitCode: null,
    telemetry: { tokens: null, costUsd: 2, turns: null, toolCalls: null },
  }),
  rec(3, "with-skill", { ...failedO1, durationMs: 300 }),
];
