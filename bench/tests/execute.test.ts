import { describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyFixture, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { Adapter, RunOptions, RunOutcome, Telemetry } from "../adapters/types";
import { executeScenario } from "../execute";
import { gitCommitAll } from "../fixture";
import { scenarioByName } from "../scenarios/registry";
import type { Scenario } from "../scenarios/types";

const OK: Telemetry = {
  tokens: null,
  costUsd: null,
  turns: null,
  toolCalls: null,
  commands: [],
  finalMessage: "done",
  model: "m",
};

function adapter(act: (o: RunOptions) => Promise<Partial<RunOutcome>>): Adapter {
  return {
    name: "codex",
    defaultModel: undefined,
    envPassthrough: [],
    async detect() {
      return { available: true, version: "0" };
    },
    async isolate() {
      return null;
    },
    async run(opts) {
      const over = await act(opts);
      await writeFile(opts.rawLogPath, "{}\n");
      return {
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
        rawLogPath: opts.rawLogPath,
        telemetry: OK,
        ...over,
      };
    },
  };
}

function req(scenario: Scenario, a: Adapter, over: Record<string, unknown> = {}) {
  return {
    adapter: a,
    scenario,
    condition: "with-skill" as const,
    model: undefined,
    timeoutMs: 1000,
    env: { PATH: process.env.PATH ?? "" },
    extraArgs: [],
    rawLogPath: "",
    keep: false,
    ...over,
  };
}

const has = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("executeScenario", () => {
  test("with-skill installs the skill and the contract; without-skill installs only the contract", async () => {
    const scenario = scenarioByName("perf-bug-new-epic") as Scenario;
    for (const condition of ["with-skill", "without-skill"] as const) {
      let seen = "";
      let skill = false;
      let contract = false;
      const a = adapter(async (o) => {
        seen = o.prompt;
        skill = await has(join(o.cwd, ".agents/skills/pmanager/SKILL.md"));
        contract = await has(join(o.cwd, "docs/pm/CONTRACT.md"));
        return {};
      });
      const dir = await makeTempDir("bench-exec");
      const r = await executeScenario(
        req(scenario, a, { condition, rawLogPath: join(dir, "raw.jsonl") }),
      );
      expect(skill).toBe(condition === "with-skill");
      expect(contract).toBe(true);
      expect(seen.startsWith("Use the pmanager skill.")).toBe(condition === "with-skill");
      expect(r.status).toBe("completed");
      expect(r.fixtureHash.startsWith("sha256:")).toBe(true);
    }
  });

  test("statuses: timeout, harness-error, setup-error on fixture hash mismatch", async () => {
    const scenario = scenarioByName("two-session-claim-conflict") as Scenario;
    const dir = await makeTempDir("bench-exec");
    const t = await executeScenario(
      req(
        scenario,
        adapter(async () => ({ exitCode: null, timedOut: true })),
        {
          rawLogPath: join(dir, "a.jsonl"),
        },
      ),
    );
    expect(t.status).toBe("timeout");
    expect(t.score).toBe(0);
    const h = await executeScenario(
      req(
        scenario,
        adapter(async () => ({ exitCode: 1 })),
        { rawLogPath: join(dir, "b.jsonl") },
      ),
    );
    expect(h.status).toBe("harness-error");
    const nf = await executeScenario(
      req(
        scenario,
        adapter(async () => ({ telemetry: { ...OK, finalMessage: null } })),
        {
          rawLogPath: join(dir, "c.jsonl"),
        },
      ),
    );
    expect(nf.status).toBe("harness-error");
    let ran = false;
    const s = await executeScenario(
      req(
        scenario,
        adapter(async () => {
          ran = true;
          return {};
        }),
        { rawLogPath: join(dir, "d.jsonl"), expectedFixtureHash: "sha256:nope" },
      ),
    );
    expect(s.status).toBe("setup-error");
    expect(ran).toBe(false);
    expect(s.outcome).toBeNull();
  });

  test("artifacts: stderr, final message and docs-pm copy are written", async () => {
    const scenario = scenarioByName("perf-bug-new-epic") as Scenario;
    const a = adapter(async (o) => {
      await copyFixture(o.cwd);
      await gitCommitAll(o.cwd, "docs(pm): spec");
      return {};
    });
    const dir = await makeTempDir("bench-exec");
    const artifactsDir = join(dir, "artifacts");
    const r = await executeScenario(
      req(scenario, a, { rawLogPath: join(dir, "raw.jsonl"), artifactsDir }),
    );
    expect(r.success).toBe(false);
    expect(r.outcomeScore).toBeGreaterThan(0.8);
    expect(await readFile(join(artifactsDir, "final-message.md"), "utf8")).toBe("done");
    expect((await stat(join(artifactsDir, "docs-pm", "app-performance", "epic.md"))).isFile()).toBe(
      true,
    );
    expect((await stat(join(artifactsDir, "stderr.txt"))).isFile()).toBe(true);
    await expect(stat(r.fixtureDir)).rejects.toThrow();
  });
});
