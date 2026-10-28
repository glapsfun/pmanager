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
  configProblem,
  formatVerdict,
} from "../agent-e2e";
import { main } from "../bench";
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

  async function setup(body: unknown = cfg) {
    const dir = await mkdtemp(join(tmpdir(), "agent-e2e-"));
    const config = join(dir, "c.json");
    await writeFile(config, JSON.stringify(body));
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

  const PASSING = [
    { id: "run-completed", kind: "diagnostic", passed: true, evidence: "" },
    { id: "o", kind: "outcome", passed: true, evidence: "" },
  ];

  function runWith(timedOut: boolean, passed: boolean, completed = true) {
    return (async () => ({
      line: { timedOut },
      score: {
        outcomes: [
          { id: "run-completed", kind: "diagnostic", passed: completed, evidence: "" },
          { id: "o", kind: "outcome", passed, evidence: "" },
        ],
      },
    })) as unknown as typeof import("../runner").runScenario;
  }

  test("a run whose harness did not complete is not a success, whatever its outcomes", async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: () => {} };
    const code = await cmdAgentE2e(await setup(), io, {
      adapterFor: (n) => fake(n, n === "claude-code"),
      run: runWith(false, true, false),
    });
    expect(code).toBe(1);
    expect(out.join("")).toContain("claude-code feature-idea-epic 0/3 FAIL");
  });

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

  test("budget precedence: flag, then config, and the env is restored", async () => {
    process.env.CLAUDE_CODE_MAX_BUDGET_USD = "99";
    const seen: (string | undefined)[] = [];
    const run = (async () => {
      seen.push(process.env.CLAUDE_CODE_MAX_BUDGET_USD);
      return {
        line: { timedOut: false },
        score: { outcomes: PASSING },
      };
    }) as unknown as typeof import("../runner").runScenario;
    const io = { out: () => {}, err: () => {} };
    const deps = { adapterFor: (n: string) => fake(n, n === "claude-code"), run };
    const base = await setup();
    await cmdAgentE2e({ ...base, maxBudgetUsd: 5 }, io, deps);
    expect(seen.every((v) => v === "5")).toBe(true);
    expect(process.env.CLAUDE_CODE_MAX_BUDGET_USD).toBe("99");
    seen.length = 0;
    await cmdAgentE2e(base, io, deps);
    expect(seen.length).toBe(SCENARIOS.length * 3);
    expect(seen.every((v) => v === "10")).toBe(true);
    expect(process.env.CLAUDE_CODE_MAX_BUDGET_USD).toBe("99");
    delete process.env.CLAUDE_CODE_MAX_BUDGET_USD;
    await cmdAgentE2e(base, io, deps);
    expect(process.env.CLAUDE_CODE_MAX_BUDGET_USD).toBeUndefined();
  });

  function throwing(failures: number) {
    let n = 0;
    return (async () => {
      if (n++ < failures) throw new Error("boom");
      return {
        line: { timedOut: false },
        score: { outcomes: PASSING },
      };
    }) as unknown as typeof import("../runner").runScenario;
  }

  test("one throwing run counts as a failure; 2 of 3 still passes", async () => {
    const out: string[] = [];
    const errs: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => errs.push(s) };
    const first = SCENARIOS[0]?.name;
    const code = await cmdAgentE2e(await setup(), io, {
      adapterFor: (n) => fake(n, n === "claude-code"),
      run: throwing(1),
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain(`claude-code ${first} 2/3 PASS`);
    expect(out.join("")).toContain("agent e2e: PASS");
    expect(errs.join("")).toContain(`claude-code ${first} run 1 threw: boom`);
  });

  test("two throwing runs of three fail the command", async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: () => {} };
    const code = await cmdAgentE2e(await setup(), io, {
      adapterFor: (n) => fake(n, n === "claude-code"),
      run: throwing(2),
    });
    expect(code).toBe(1);
    expect(out.join("")).toContain("agent e2e: FAIL");
  });

  test("a throwing detect makes the harness unavailable", async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: () => {} };
    const bad = {
      name: "claude-code",
      detect: async () => {
        throw new Error("nope");
      },
    } as unknown as Adapter;
    const code = await cmdAgentE2e(await setup(), io, {
      adapterFor: (n) => (n === "claude-code" ? bad : fake(n, false)),
      run: throwing(0),
    });
    expect(code).toBe(1);
    expect(out.join("")).toContain("claude-code unavailable");
  });

  test("a missing config is a usage error", async () => {
    const errs: string[] = [];
    const a = parseArgs(["agent-e2e", "--config", "/nonexistent/x.json"]);
    expect(await cmdAgentE2e(a, { out: () => {}, err: (s) => errs.push(s) })).toBe(2);
  });

  test("a blocking harness that is unavailable stops before any run", async () => {
    const out: string[] = [];
    let runs = 0;
    const run = (async () => {
      runs++;
      throw new Error("must not run");
    }) as unknown as typeof import("../runner").runScenario;
    const code = await cmdAgentE2e(
      await setup(),
      { out: (s) => out.push(s), err: () => {} },
      { adapterFor: (n) => fake(n, n === "codex"), run },
    );
    expect(code).toBe(1);
    expect(runs).toBe(0);
    expect(out.join("")).toBe("claude-code unavailable\nagent e2e: FAIL\n");
  });

  test("a config whose blocking is not a boolean, or with no blocking harness, is a usage error", async () => {
    const notBool = {
      ...cfg,
      harnesses: [{ name: "claude-code", model: "m", blocking: "yes" }],
    };
    const noneBlocking = {
      ...cfg,
      harnesses: cfg.harnesses.map((h) => ({ ...h, blocking: false })),
    };
    for (const [bad, reason] of [
      [notBool, "claude-code blocking must be true or false"],
      [noneBlocking, "at least one harness must be blocking"],
    ] as const) {
      const errs: string[] = [];
      const code = await cmdAgentE2e(
        await setup(bad),
        { out: () => {}, err: (s) => errs.push(s) },
        { adapterFor: (n) => fake(n, true), run: runWith(false, true) },
      );
      expect(code).toBe(2);
      expect(errs.join("")).toContain(reason);
    }
  });
});

test("configProblem accepts the shipped config", async () => {
  const shipped = JSON.parse(await Bun.file(join(import.meta.dir, "..", "agent-e2e.json")).text());
  expect(configProblem(shipped)).toBeNull();
});

test("agent-e2e rejects the flags its config file owns", async () => {
  for (const argv of [
    ["--runs", "2"],
    ["--scenario", "feature-idea-epic"],
    ["--harness", "codex"],
    ["--model", "m"],
  ]) {
    const errs: string[] = [];
    const code = await main(["agent-e2e", ...argv], { out: () => {}, err: (s) => errs.push(s) });
    expect(code).toBe(2);
    expect(errs.join("")).toContain(`agent-e2e takes ${argv[0]} from its config file`);
  }
});
