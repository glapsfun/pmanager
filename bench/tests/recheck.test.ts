import { describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { Adapter, RunOptions, RunOutcome, Telemetry } from "../adapters/types";
import { createExperiment, readManifest, runExperiment } from "../experiment";
import { formatRecheck, overlay, recheckExperiment } from "../recheck";
import { REPO_ROOT } from "../skill-paths";

const OK: Telemetry = {
  tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0.5,
  turns: 1,
  toolCalls: {},
  commands: [],
  finalMessage: "done",
  model: "claude-sonnet-5",
};

const SAMPLE = join(
  REPO_ROOT,
  "plugins/pmanager/skills/pmanager/tests/fixtures/webshop/docs/pm/app-performance",
);

/** Writes the sample epic under a new slug, as a planner would leave it. */
async function writeEpic(cwd: string, slug: string, badDependency: boolean): Promise<void> {
  const to = join(cwd, "docs", "pm", slug);
  await cp(SAMPLE, to, { recursive: true });
  for (const rel of [
    "epic.md",
    "plan.md",
    ...(await readdir(join(to, "tasks"))).map((f) => `tasks/${f}`),
  ]) {
    const p = join(to, rel);
    let text = (await readFile(p, "utf8")).replaceAll("app-performance", slug);
    if (badDependency && rel.startsWith("tasks/T04"))
      text = text.replace("depends-on: []", "depends-on: [T99]");
    await writeFile(p, text);
  }
}

function adapter(act: (o: RunOptions) => Promise<Partial<RunOutcome>>): Adapter {
  return {
    name: "claude-code",
    defaultModel: undefined,
    envPassthrough: [],
    async detect() {
      return { available: true, version: "9.9.9" };
    },
    async isolate() {
      return { mode: "fake", env: {}, args: () => [], cleanup: async () => undefined };
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

describe("experiment recheck", () => {
  test("overlay keeps the fixture's repo map and profiles and adds what the attempt wrote", async () => {
    const root = await makeTempDir("bench-overlay");
    const saved = join(root, "saved");
    const pm = join(root, "pm");
    for (const [base, files] of [
      [
        saved,
        {
          ".local/repos.json": "attempt",
          "projects/old.md": "attempt",
          "projects/new.md": "attempt",
          "fix/epic.md": "attempt",
          "INDEX.md": "attempt",
        },
      ],
      [pm, { ".local/repos.json": "fixture", "projects/old.md": "fixture", "INDEX.md": "fixture" }],
    ] as const) {
      for (const [rel, text] of Object.entries(files)) {
        await mkdir(join(base, rel, ".."), { recursive: true });
        await writeFile(join(base, rel), text);
      }
    }
    await overlay(saved, pm);
    const read = (rel: string) => readFile(join(pm, rel), "utf8");
    expect(await read(".local/repos.json")).toBe("fixture");
    expect(await read("projects/old.md")).toBe("fixture");
    expect(await read("projects/new.md")).toBe("attempt");
    expect(await read("fix/epic.md")).toBe("attempt");
    expect(await read("INDEX.md")).toBe("attempt");
  });

  test("replays each completed attempt's new epic through this checkout's pm check", async () => {
    const root = await makeTempDir("bench-recheck");
    let n = 0;
    const a = adapter(async (o) => {
      n++;
      // pair 2 runs without-skill first, so the fourth call is its with-skill attempt
      if (n === 4) return { timedOut: true, exitCode: null };
      await writeEpic(o.cwd, "orders-fix", o.extraArgs?.includes("--cond=with-skill") ?? false);
      return {};
    });
    a.isolate = async () => ({
      mode: "fake",
      env: {},
      args: (c) => [`--cond=${c}`],
      cleanup: async () => undefined,
    });
    await createExperiment(
      {
        id: "r1",
        harness: "claude-code",
        model: "claude-sonnet-5",
        conditions: ["with-skill", "without-skill"],
        pairs: 2,
        scenarios: ["two-session-claim-conflict"],
        timeoutS: 10,
      },
      {
        adapter: a,
        experimentsDir: root,
        repoSha: async () => "abc1234",
        repoDirty: async () => false,
      },
    );
    const dir = join(root, "r1");
    await runExperiment(dir, {
      adapter: a,
      env: { PATH: process.env.PATH ?? "" },
      home: root,
      tmp: root,
    });

    const r = await recheckExperiment(dir);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) expect(row.epic).toBe("orders-fix");
    for (const row of r.rows) expect(row.problem).toBeUndefined();
    const ref = (c: string) =>
      r.rows
        .filter((x) => x.condition === c)
        .map((x) => x.findings.some((f) => f.rule === "E-REF-003"));
    expect(ref("with-skill")).toEqual([true]);
    expect(ref("without-skill")).toEqual([false, false]);

    const text = formatRecheck("r1", ["with-skill", "without-skill"], r);
    expect(text).toContain("E-REF-003");
    expect(text).toMatch(/E-REF-003\s+with-skill 1 of 1, without-skill 0 of 2/);

    const m = await readManifest(dir);
    const entry = m.scenarios[0];
    if (!entry) throw new Error("no scenario entry");
    entry.fixtureHash = "sha256:old";
    await writeFile(join(dir, "manifest.json"), JSON.stringify(m));
    const again = await recheckExperiment(dir);
    expect(again.warnings.join("\n")).toContain("two-session-claim-conflict");
    expect(again.rows).toHaveLength(3);
  }, 120_000);
});
