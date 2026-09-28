import { describe, expect, test } from "bun:test";
import { DEFAULT_BUDGET, estimateTokens } from "../scripts/prune";
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
});
