import { describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyFixture, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { claudeCode } from "../adapters/claude-code";
import type { Adapter, RunOptions, RunOutcome, Telemetry } from "../adapters/types";
import { executeScenario } from "../execute";
import { gitCommitAll, headSha } from "../fixture";
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

  test("baseline-skill installs the skill from the given directory", async () => {
    const scenario = scenarioByName("perf-bug-new-epic") as Scenario;
    const skillDir = await makeTempDir("bench-baseline-skill");
    await writeFile(join(skillDir, "SKILL.md"), "baseline marker\n");
    let installed = "";
    let seen = "";
    const a = adapter(async (o) => {
      seen = o.prompt;
      installed = await readFile(join(o.cwd, ".agents/skills/pmanager/SKILL.md"), "utf8");
      return {};
    });
    const dir = await makeTempDir("bench-exec");
    await executeScenario(
      req(scenario, a, {
        condition: "baseline-skill",
        skillDir,
        rawLogPath: join(dir, "raw.jsonl"),
      }),
    );
    expect(installed).toBe("baseline marker\n");
    expect(seen.startsWith("Use the pmanager skill.")).toBe(true);
  });

  test("prepareCondition gets the condition, and grading uses the baseline it returns", async () => {
    const base = scenarioByName("perf-bug-new-epic") as Scenario;
    let seen = "";
    const scenario: Scenario = {
      ...base,
      async prepareCondition(dir, condition, info) {
        seen = condition;
        await writeFile(join(dir, "PREPARED.md"), "prepared for the condition\n");
        await gitCommitAll(dir, "prepare");
        return { ...info, baselineSha: await headSha(dir) };
      },
    };
    let sawFile = false;
    const a = adapter(async (o) => {
      sawFile = await has(join(o.cwd, "PREPARED.md"));
      return {};
    });
    const skillDir = await makeTempDir("bench-prepare-skill");
    await writeFile(join(skillDir, "SKILL.md"), "baseline\n");
    const dir = await makeTempDir("bench-exec");
    const r = await executeScenario(
      req(scenario, a, {
        condition: "baseline-skill",
        skillDir,
        rawLogPath: join(dir, "raw.jsonl"),
      }),
    );
    expect(seen).toBe("baseline-skill");
    expect(sawFile).toBe(true);
    expect(r.checks.find((c) => c.id === "scoped-diff")?.passed).toBe(true);
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

  test("cleanup removes the fixture's <dir>-pm-* siblings, not only the fixture", async () => {
    const base = scenarioByName("perf-bug-new-epic");
    if (!base) throw new Error("scenario missing");
    const s: Scenario = {
      ...base,
      name: "with-siblings",
      checks: [],
      async buildFixture(dir) {
        const info = await base.buildFixture(dir);
        await mkdir(`${dir}-pm-workspace`);
        await writeFile(join(`${dir}-pm-workspace`, "target.txt"), "a target repo\n");
        return info;
      },
    };
    const rawLogPath = join(await makeTempDir("raw"), "raw.jsonl");
    const r = await executeScenario(
      req(
        s,
        adapter(async () => ({})),
        { rawLogPath },
      ),
    );
    expect(await has(r.fixtureDir)).toBe(false);
    expect(await has(`${r.fixtureDir}-pm-workspace`)).toBe(false);
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

  test("an offline scenario runs with the offline env and the adapter's offline args", async () => {
    const scenario = { ...(scenarioByName("perf-bug-new-epic") as Scenario), offline: true };
    let seen: RunOptions | null = null;
    const a = {
      ...adapter(async (o) => {
        seen = o;
        return {};
      }),
      offlineArgs: ["--no-web"],
    };
    const dir = await makeTempDir("bench-exec");
    const r = await executeScenario(
      req(scenario, a, { extraArgs: ["--first"], rawLogPath: join(dir, "raw.jsonl") }),
    );
    expect(r.status).toBe("completed");
    const o = seen as unknown as RunOptions;
    expect(o.env.GOPROXY).toBe("off");
    expect(o.env.npm_config_registry?.startsWith("http://127.0.0.1:")).toBe(true);
    expect(o.env.PATH).toBe(process.env.PATH ?? "");
    expect(o.extraArgs).toEqual(["--first", "--no-web"]);
  });

  test("a scenario without offline runs unchanged", async () => {
    const scenario = scenarioByName("perf-bug-new-epic") as Scenario;
    let seen: RunOptions | null = null;
    const a = {
      ...adapter(async (o) => {
        seen = o;
        return {};
      }),
      offlineArgs: ["--no-web"],
    };
    const dir = await makeTempDir("bench-exec");
    await executeScenario(req(scenario, a, { rawLogPath: join(dir, "raw.jsonl") }));
    const o = seen as unknown as RunOptions;
    expect(o.env.GOPROXY).toBeUndefined();
    expect(o.extraArgs ?? []).not.toContain("--no-web");
  });

  test("an offline scenario on an adapter without offline args is a setup error", async () => {
    const scenario = { ...(scenarioByName("perf-bug-new-epic") as Scenario), offline: true };
    let ran = false;
    const a = adapter(async () => {
      ran = true;
      return {};
    });
    const dir = await makeTempDir("bench-exec");
    const r = await executeScenario(req(scenario, a, { rawLogPath: join(dir, "raw.jsonl") }));
    expect(r.status).toBe("setup-error");
    expect(r.statusReason).toContain("cannot turn off web tools");
    expect(ran).toBe(false);
  });

  test("claude-code denies the web tools", () => {
    expect(claudeCode.offlineArgs).toEqual(["--disallowedTools", "WebFetch,WebSearch"]);
  });
});
