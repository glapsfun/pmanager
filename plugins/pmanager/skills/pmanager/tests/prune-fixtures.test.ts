import { describe, expect, test } from "bun:test";
import { DEFAULT_BUDGET, estimateTokens, prune } from "../scripts/prune";
import { buildResearch, formatResearch, type ResearchReport } from "../scripts/research";
import { RESEARCH_FIXTURES, type ResearchFixture } from "./fixtures/research-fixtures";
import { makeTempDir } from "./helpers";

async function research(f: ResearchFixture): Promise<ResearchReport> {
  const dir = await makeTempDir(`prune-${f.name}`);
  await f.build(dir);
  return buildResearch({
    root: dir,
    cwd: dir,
    keywords: f.keywords,
    paths: [],
    limit: 20,
    gh: false,
  });
}

const byName = (name: string) => RESEARCH_FIXTURES.find((f) => f.name === name) as ResearchFixture;

describe("research fixtures", () => {
  test("every must-keep line is in the unpruned output", async () => {
    for (const f of RESEARCH_FIXTURES) {
      const full = formatResearch(await research(f));
      for (const line of f.mustKeep) expect(full).toContain(line);
    }
  });

  test("the noisy fixture's full output is over the default budget, so pruning has work", async () => {
    const full = formatResearch(await research(byName("noisy")));
    expect(estimateTokens(full)).toBeGreaterThan(DEFAULT_BUDGET);
    expect(full).toContain("[data/invoices.jsonl:1]");
    expect(full).toContain("[src/billing/invoice.ts:1] import { retry }");
  });

  test("must-keep lines survive the default budget, the output fits it, and pruning is stable", async () => {
    for (const f of RESEARCH_FIXTURES) {
      const r = await research(f);
      const full = formatResearch({ ...r, pruned: null });
      const pruned = prune(r);
      const text = formatResearch(pruned);
      for (const line of f.mustKeep) expect(text).toContain(line);
      expect(estimateTokens(text)).toBeLessThanOrEqual(DEFAULT_BUDGET);
      expect(prune(r)).toEqual(pruned);
      const fullLines = new Set(full.split("\n"));
      const emitted = text.split("\n").filter((l) => l.startsWith("  "));
      for (const line of emitted) {
        if (/^ {2}\[[^\]:]+\] imports( |$)/.test(line)) continue;
        expect(fullLines.has(line)).toBe(true);
      }
    }
  });

  test("webshop: nothing to prune, so the output equals --full", async () => {
    const r = await research(byName("webshop"));
    const pruned = prune(r);
    expect(pruned.pruned).toMatchObject({ import: 0, data: 0, budget: 0 });
    expect(formatResearch(pruned)).toBe(formatResearch({ ...r, pruned: null }));
  });

  test("noisy: data files and imports are the first things cut", async () => {
    const pruned = prune(await research(byName("noisy")));
    expect(pruned.pruned).toMatchObject({ import: 4, data: 6 });
    const text = formatResearch(pruned);
    expect(text).not.toContain("data/invoices.jsonl");
    expect(text).not.toContain("package-lock.json");
    expect(text).not.toContain("dist/billing.min.js");
    expect(text).not.toContain("import { retry }");
  });
});
