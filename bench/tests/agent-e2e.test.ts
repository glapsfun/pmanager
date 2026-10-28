import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter } from "../adapters/types";
import {
  type AgentE2eConfig,
  type AgentRunResult,
  agentVerdict,
  cmdAgentE2e,
  formatVerdict,
} from "../agent-e2e";
import { parseArgs } from "../cli-args";
import { SCENARIOS } from "../scenarios/registry";

const cfg: AgentE2eConfig = {
  runs: 3,
  need: 2,
  harnesses: [
    { name: "claude-code", model: "claude-sonnet-5", blocking: true, maxBudgetUsd: 10 },
    { name: "codex", model: "gpt-6-astra", blocking: false },
  ],
};

function results(
  claude: (scenario: string) => boolean[],
  codex: boolean[] = [false, false, false],
): AgentRunResult[] {
  const out: AgentRunResult[] = [];
  for (const s of SCENARIOS) {
    for (const success of claude(s.name)) {
      out.push({ harness: "claude-code", scenario: s.name, success });
    }
    for (const success of codex) out.push({ harness: "codex", scenario: s.name, success });
  }
  return out;
}

describe("agentVerdict", () => {
  test("2 of 3 passes a scenario; blocking harness decides", () => {
    const v = agentVerdict(
      results(() => [true, true, false]),
      cfg,
      [],
    );
    expect(v.pass).toBe(true);
    const codexRows = v.rows.filter((r) => r.harness === "codex");
    expect(codexRows.length).toBe(SCENARIOS.length);
    expect(codexRows.every((r) => !r.passed && !r.blocking)).toBe(true);
  });

  test("1 of 3 on a blocking harness fails", () => {
    const first = SCENARIOS[0]?.name;
    const v = agentVerdict(
      results((s) => (s === first ? [true, false, false] : [true, true, true])),
      cfg,
      [],
    );
    expect(v.pass).toBe(false);
  });

  test("unavailable blocking harness fails, unavailable report-only harness does not", () => {
    const all = results(() => [true, true, true]);
    expect(agentVerdict(all, cfg, ["claude-code"]).pass).toBe(false);
    const v = agentVerdict(all, cfg, ["codex"]);
    expect(v.pass).toBe(true);
    expect(v.unavailable).toEqual([{ harness: "codex", blocking: false }]);
  });

  test("formatVerdict marks report-only rows", () => {
    const text = formatVerdict(
      agentVerdict(
        results(() => [true, true, false]),
        cfg,
        [],
      ),
    );
    expect(text).toContain("codex feature-idea-epic 0/3 FAIL [report-only]");
    expect(text).toContain("claude-code feature-idea-epic 2/3 PASS\n");
    expect(text.trimEnd().endsWith("agent e2e: PASS")).toBe(true);
  });
});

describe("cmdAgentE2e", () => {
  const saved = process.env.CLAUDE_CODE_MAX_BUDGET_USD;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CODE_MAX_BUDGET_USD;
    else process.env.CLAUDE_CODE_MAX_BUDGET_USD = saved;
  });

  const fake = (name: string, available: boolean) =>
    ({ name, detect: async () => ({ available, version: "1" }) }) as unknown as Adapter;

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "agent-e2e-"));
    const config = join(dir, "c.json");
    await writeFile(config, JSON.stringify(cfg));
    const argv = [
      "agent-e2e",
      "--config",
      config,
      "--history",
      join(dir, "h.jsonl"),
      "--report",
      join(dir, "r.md"),
    ];
    return parseArgs(argv);
  }

  function runWith(timedOut: boolean, passed: boolean) {
    return (async () => ({
      line: { timedOut },
      score: { outcomes: [{ id: "o", kind: "outcome", passed, evidence: "" }] },
    })) as unknown as typeof import("../runner").runScenario;
  }

  test("a timed-out run is not a success and fails the blocking harness", async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: () => {} };
    const code = await cmdAgentE2e(await setup(), io, {
      adapterFor: (n) => fake(n, n === "claude-code"),
      run: runWith(true, true),
    });
    expect(code).toBe(1);
    expect(out.join("")).toContain("claude-code feature-idea-epic 0/3 FAIL");
  });

  test("passing runs exit 0 and an unavailable report-only harness is tolerated", async () => {
    const io = { out: () => {}, err: () => {} };
    const code = await cmdAgentE2e(await setup(), io, {
      adapterFor: (n) => fake(n, n === "claude-code"),
      run: runWith(false, true),
    });
    expect(code).toBe(0);
  });

  test("a missing config is a usage error", async () => {
    const errs: string[] = [];
    const a = parseArgs(["agent-e2e", "--config", "/nonexistent/x.json"]);
    expect(await cmdAgentE2e(a, { out: () => {}, err: (s) => errs.push(s) })).toBe(2);
  });
});
