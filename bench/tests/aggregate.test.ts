import { describe, expect, test } from "bun:test";
import { aggregate, quartiles } from "../aggregate";
import { attempts, manifest, rec } from "./fixtures/experiment-fixture";

describe("quartiles", () => {
  test("median and quartiles by linear interpolation; null when empty", () => {
    expect(quartiles([])).toBeNull();
    expect(quartiles([100, 200, 300])).toEqual({ median: 200, q1: 150, q3: 250, n: 3 });
    expect(quartiles([5])).toEqual({ median: 5, q1: 5, q3: 5, n: 1 });
  });
});

describe("aggregate", () => {
  const s = aggregate(manifest, attempts);
  const g = (c: "with-skill" | "without-skill") => s.groups.find((x) => x.condition === c);

  test("group counts, rates and spread", () => {
    expect(g("with-skill")).toMatchObject({
      planned: 3,
      attempted: 3,
      completed: 3,
      successRate: 2 / 3,
    });
    expect(g("with-skill")?.score).toEqual({ median: 1, q1: 0.75, q3: 1, n: 3 });
    expect(g("with-skill")?.durationMs).toEqual({ median: 200, q1: 150, q3: 250, n: 3 });
    expect(g("with-skill")?.checkFailureRate).toEqual({ o1: 1 / 3, c1: 0 });
    expect(g("with-skill")?.cost).toEqual({ sumUsd: 2, n: 2 });
    expect(g("with-skill")?.tokens.input).toEqual({ median: 10, q1: 10, q3: 10, n: 2 });
    expect(g("with-skill")?.tokens.fresh).toEqual({ median: 10, q1: 10, q3: 10, n: 2 });
    expect(g("without-skill")).toMatchObject({
      planned: 3,
      attempted: 2,
      completed: 1,
      successRate: 0,
    });
    expect(g("without-skill")?.failed.timeout).toBe(1);
    expect(g("without-skill")?.cost).toEqual({ sumUsd: 3, n: 2 });
  });

  test("pairing uses completed pairs only and reports exclusions", () => {
    const p = s.pairings[0];
    expect(p?.pairsCompleted).toBe(1);
    expect(p?.pairsExcluded).toBe(2);
    expect(p?.diffs).toEqual([{ pair: 1, scenario: "s", scoreDiff: 0.5, successDiff: 1 }]);
    expect(p?.scoreDiff).toEqual({ median: 0.5, q1: 0.5, q3: 0.5, n: 1 });
    expect(p?.successDiff).toBe(1);
  });

  test("labels", () => {
    expect(s.preliminary).toBe(true);
    expect(s.noCostTelemetry).toBe(false);
    expect(s.spendUsd).toBe(5);
  });
});

describe("cost, duration and step statistics", () => {
  const m = { ...manifest, pairs: 2 };
  const run = (
    pair: number,
    condition: "with-skill" | "without-skill",
    costUsd: number,
    durationMs: number,
    modelCalls: number | null,
  ) =>
    rec(pair, condition, {
      durationMs,
      telemetry: {
        tokens: null,
        costUsd,
        turns: null,
        toolCalls: null,
        trace: {
          preFramingContext: null,
          preFramingToolBytes: null,
          preResearchCommands: null,
          modelCalls,
        },
      },
    });

  test("cost per run and paired cost, duration and step diffs", () => {
    const s = aggregate(m, [
      run(1, "with-skill", 1.0, 100000, 20),
      run(1, "without-skill", 0.8, 90000, 25),
      run(2, "with-skill", 1.2, 120000, 22),
      run(2, "without-skill", 1.0, 100000, 27),
    ]);
    const withSkill = s.groups.find((g) => g.condition === "with-skill");
    const p = s.pairings[0];
    expect(withSkill?.costPerRun?.median).toBeCloseTo(1.1);
    expect(p?.costDiff?.median).toBeCloseTo(0.2);
    expect(p?.durationDiff?.median).toBe(15000);
    expect(p?.callsDiff?.median).toBe(-5);
    expect(withSkill?.trace.modelCalls?.median).toBe(21);
  });

  test("a pair missing modelCalls on one side is left out of callsDiff only", () => {
    const s = aggregate(m, [
      run(1, "with-skill", 1.0, 100000, 20),
      run(1, "without-skill", 0.8, 90000, null),
      run(2, "with-skill", 1.2, 120000, 22),
      run(2, "without-skill", 1.0, 100000, 27),
    ]);
    const p = s.pairings[0];
    expect(p?.callsDiff).toEqual({ median: -5, q1: -5, q3: -5, n: 1 });
    expect(p?.costDiff?.n).toBe(2);
    expect(p?.durationDiff?.n).toBe(2);
  });
});
