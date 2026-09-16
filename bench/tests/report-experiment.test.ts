import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { aggregate } from "../aggregate";
import { renderReadmeSection, renderReport } from "../report";
import { renderExperimentReport, renderExperimentsSection } from "../report-experiment";
import { attempts, manifest } from "./fixtures/experiment-fixture";

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

  test("no experiments leaves the existing renderings byte-identical", () => {
    expect(renderReport([])).toBe(renderReport([], []));
    expect(renderReadmeSection([])).toBe(renderReadmeSection([], []));
  });
});
