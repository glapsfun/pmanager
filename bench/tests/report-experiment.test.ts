import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { aggregate } from "../aggregate";
import { planAttempts } from "../experiment";
import { renderReadmeSection, renderReport } from "../report";
import { renderExperimentReport, renderExperimentsSection } from "../report-experiment";
import type { Condition } from "../scenarios/types";
import { attempts, manifest, rec } from "./fixtures/experiment-fixture";

describe("experiment report", () => {
  test("REPORT.md matches the golden", async () => {
    const golden = await readFile(join(import.meta.dir, "golden", "REPORT.md"), "utf8");
    expect(renderExperimentReport(manifest, aggregate(manifest, attempts))).toBe(golden);
  });

  test("the experiments section is shared by BENCH.md and the README region", async () => {
    const items = [{ m: manifest, s: aggregate(manifest, attempts) }];
    const section = renderExperimentsSection(items).join("\n");
    expect(renderReport([], items)).toContain(section);
    expect(renderReadmeSection([], items)).toContain(section);
    const golden = await readFile(join(import.meta.dir, "golden", "BENCH-experiments.md"), "utf8");
    expect(section).toBe(golden);
  });

  test("pre-framing section and baseline headline appear only with the data", () => {
    const conditions: Condition[] = ["with-skill", "baseline-skill"];
    const m = {
      ...manifest,
      conditions,
      pairs: 2,
      planned: planAttempts("t", ["s"], conditions, 2),
      baseline: { ref: "main", sha: "0123456789abcdef", skillHash: "sha256:b" },
    };
    const t = (ctx: number) => ({
      tokens: null,
      costUsd: null,
      turns: null,
      toolCalls: null,
      trace: { preFramingContext: ctx, preFramingToolBytes: ctx * 2, preResearchCommands: 1 },
    });
    const traced = [
      rec(1, "with-skill", { telemetry: t(10000) }),
      rec(1, "baseline-skill", { telemetry: t(15000) }),
      rec(2, "with-skill", { telemetry: t(12000) }),
      rec(2, "baseline-skill", { telemetry: t(16000) }),
    ];
    const out = renderExperimentReport(m, aggregate(m, traced));
    expect(out).toContain(" · baseline main @ 0123456");
    expect(out).toContain("## Pre-framing context");
    expect(out).toContain(
      "| s | with-skill | 11000 (10500–11500; n 2) | 22000 (21000–23000; n 2) | 1 (1–1; n 2) |",
    );
    expect(out).toContain(
      "| s | baseline-skill | 15500 (15250–15750; n 2) | 31000 (30500–31500; n 2) | 1 (1–1; n 2) |",
    );
    expect(out).toContain("| s | -4500 (-4750–-4250; n 2) |");
    expect(renderExperimentReport(manifest, aggregate(manifest, attempts))).not.toContain(
      "Pre-framing",
    );
  });

  test("no experiments leaves the existing renderings byte-identical", () => {
    expect(renderReport([])).toBe(renderReport([], []));
    expect(renderReadmeSection([])).toBe(renderReadmeSection([], []));
  });
});
