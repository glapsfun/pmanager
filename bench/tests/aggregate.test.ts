import { describe, expect, test } from "bun:test";
import { aggregate, quartiles } from "../aggregate";
import { attempts, manifest } from "./fixtures/experiment-fixture";

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
