import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitOk } from "../../plugins/pmanager/skills/pmanager/scripts/git";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { Adapter, RunOptions, RunOutcome, Telemetry } from "../adapters/types";
import {
  createExperiment,
  planAttempts,
  readAttempts,
  readManifest,
  remaining,
  runExperiment,
} from "../experiment";
import type { Condition } from "../scenarios/types";
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

function adapter(act: (o: RunOptions) => Promise<Partial<RunOutcome>>, isolate = true): Adapter {
  return {
    name: "claude-code",
    defaultModel: undefined,
    envPassthrough: [],
    async detect() {
      return { available: true, version: "9.9.9" };
    },
    async isolate() {
      return isolate
        ? {
            mode: "fake",
            env: { FAKE_ISO: "1" },
            args: (c) => [`--cond=${c}`],
            cleanup: async () => undefined,
          }
        : null;
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

const deps = (a: Adapter, dir: string) => ({
  adapter: a,
  experimentsDir: dir,
  repoSha: async () => "abc1234",
  repoDirty: async () => false,
});

const CLAIM = "two-session-claim-conflict";

describe("planAttempts", () => {
  test("alternates the first condition by pair parity", () => {
    const p = planAttempts("e", ["s1", "s2"], ["with-skill", "without-skill"], 2);
    expect(p.map((x) => [x.pair, x.scenario, x.condition, x.order])).toEqual([
      [1, "s1", "with-skill", 1],
      [1, "s1", "without-skill", 2],
      [1, "s2", "with-skill", 1],
      [1, "s2", "without-skill", 2],
      [2, "s1", "without-skill", 1],
      [2, "s1", "with-skill", 2],
      [2, "s2", "without-skill", 1],
      [2, "s2", "with-skill", 2],
    ]);
    expect(p[0]?.attemptId).toBe("e-p1-s1-with-skill");
  });
});

describe("experiment lifecycle", () => {
  test("create writes a manifest with hashes; run executes, resumes, isolates and records", async () => {
    const root = await makeTempDir("bench-exp");
    let calls = 0;
    const seenArgs: string[][] = [];
    const seenEnv: Record<string, string>[] = [];
    const a = adapter(async (o) => {
      calls++;
      seenArgs.push(o.extraArgs ?? []);
      seenEnv.push(o.env);
      if (calls === 3) throw new Error("boom");
      return {};
    });
    const m = await createExperiment(
      {
        id: "e1",
        harness: "claude-code",
        model: "claude-sonnet-5",
        conditions: ["with-skill", "without-skill"],
        pairs: 2,
        scenarios: [CLAIM],
        timeoutS: 10,
      },
      deps(a, root),
    );
    expect(m.planned).toHaveLength(4);
    expect(m.skillHash.startsWith("sha256:")).toBe(true);
    expect(m.scenarios[0]?.fixtureHash.startsWith("sha256:")).toBe(true);
    expect(m.isolation).toBe("fake");
    const dir = join(root, "e1");
    expect(await readManifest(dir)).toEqual(m);

    await expect(
      runExperiment(dir, { adapter: a, env: { PATH: "" }, home: root, tmp: root }),
    ).rejects.toThrow("boom");
    let done = await readAttempts(dir);
    expect(done).toHaveLength(2);
    expect(remaining(m, done)).toHaveLength(2);
    expect(done[0]?.condition).toBe("with-skill");
    expect(done[0]?.status).toBe("completed");
    expect(done[0]?.modelResolved).toBe("claude-sonnet-5");
    expect(seenArgs[0]).toEqual(["--cond=with-skill"]);
    expect(seenEnv[0]?.FAKE_ISO).toBe("1");
    const art = join(dir, "artifacts", done[0]?.attemptId as string, "final-message.md");
    expect((await stat(art)).isFile()).toBe(true);

    const r = await runExperiment(dir, { adapter: a, env: { PATH: "" }, home: root, tmp: root });
    expect(r).toEqual({ ran: 2, remaining: 0 });
    done = await readAttempts(dir);
    expect(done.map((d) => d.attemptId)).toEqual(m.planned.map((p) => p.attemptId));
  });

  test("a model mismatch is a setup-error; refusal without isolation for two conditions", async () => {
    const root = await makeTempDir("bench-exp");
    const wrong = adapter(async () => ({ telemetry: { ...OK, model: "other-model" } }));
    const m = await createExperiment(
      {
        id: "e2",
        harness: "claude-code",
        model: "claude-sonnet-5",
        conditions: ["with-skill"],
        pairs: 1,
        scenarios: [CLAIM],
        timeoutS: 10,
      },
      deps(wrong, root),
    );
    await runExperiment(join(root, "e2"), {
      adapter: wrong,
      env: { PATH: "" },
      home: root,
      tmp: root,
    });
    const done = await readAttempts(join(root, "e2"));
    expect(done[0]?.status).toBe("setup-error");
    expect(done[0]?.statusReason).toContain("other-model");
    expect(m.isolation).toBe("fake");

    const noIso = adapter(async () => ({}), false);
    await expect(
      createExperiment(
        {
          id: "e3",
          harness: "claude-code",
          model: "m",
          conditions: ["with-skill", "without-skill"],
          pairs: 1,
          scenarios: [CLAIM],
          timeoutS: 10,
        },
        deps(noIso, root),
      ),
    ).rejects.toThrow(/isolation/);
  });

  test("an existing id is refused, stale inputs are refused on run, malformed history is an error", async () => {
    const root = await makeTempDir("bench-exp");
    const a = adapter(async () => ({}));
    const opts = {
      id: "e4",
      harness: "claude-code" as const,
      model: "claude-sonnet-5",
      conditions: ["with-skill"] as const,
      pairs: 1,
      scenarios: [CLAIM],
      timeoutS: 10,
    };
    const m = await createExperiment({ ...opts, conditions: [...opts.conditions] }, deps(a, root));
    await expect(
      createExperiment(
        { ...opts, conditions: [...opts.conditions], model: "other" },
        deps(a, root),
      ),
    ).rejects.toThrow(/already exists/);
    const dir = join(root, "e4");
    const stale = {
      ...m,
      skillHash: "sha256:stale",
      contractHash: "sha256:stale",
      harnessVersion: "0.0.0",
      scenarios: [
        { ...m.scenarios[0], graderVersion: 99, promptHash: "sha256:stale" },
        { ...m.scenarios[0], name: "gone" },
      ],
    };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(stale));
    await expect(
      runExperiment(dir, { adapter: a, env: { PATH: "" }, home: root, tmp: root }),
    ).rejects.toThrow(
      /harness version[\s\S]*skill hash[\s\S]*contract hash[\s\S]*prompt of[\s\S]*grader version[\s\S]*gone no longer exists/,
    );
    expect(await readAttempts(dir)).toEqual([]);
    await writeFile(join(dir, "attempts.jsonl"), '{"attemptId":"x"}\n\n\nnot json\n');
    await expect(readAttempts(dir)).rejects.toThrow(/malformed JSON on line 4/);
  });

  test("a run stops when the experiment directory disappears", async () => {
    const root = await makeTempDir("bench-exp");
    let calls = 0;
    const a = adapter(async () => {
      calls++;
      return {};
    });
    await createExperiment(
      {
        id: "e5",
        harness: "claude-code",
        model: "claude-sonnet-5",
        conditions: ["with-skill"],
        pairs: 2,
        scenarios: [CLAIM],
        timeoutS: 10,
      },
      deps(a, root),
    );
    await expect(
      runExperiment(join(root, "e5"), {
        adapter: a,
        env: { PATH: "" },
        home: root,
        tmp: root,
        onAttempt: () => rmSync(join(root, "e5"), { recursive: true, force: true }),
      }),
    ).rejects.toThrow(/was removed while the experiment was running/);
    expect(calls).toBe(1);
  });
});

describe("baseline experiments", () => {
  test("create extracts the committed skill and pins ref, sha and hash; run installs it", async () => {
    const root = await makeTempDir("bench-exp");
    const seenArgs: string[][] = [];
    const a = adapter(async (o) => {
      seenArgs.push(o.extraArgs ?? []);
      return {};
    });
    const m = await createExperiment(
      {
        id: "b1",
        harness: "claude-code",
        model: "claude-sonnet-5",
        conditions: ["with-skill", "baseline-skill"],
        baseline: "HEAD",
        pairs: 1,
        scenarios: [CLAIM],
        timeoutS: 10,
      },
      deps(a, root),
    );
    const head = (await gitOk(["rev-parse", "HEAD"], REPO_ROOT)).trim();
    expect(m.baseline?.ref).toBe("HEAD");
    expect(m.baseline?.sha).toBe(head);
    expect(m.baseline?.skillHash.startsWith("sha256:")).toBe(true);
    const dir = join(root, "b1");
    const committed = await gitOk(
      ["show", `${head}:plugins/pmanager/skills/pmanager/SKILL.md`],
      REPO_ROOT,
    );
    expect(await readFile(join(dir, "baseline-skill", "SKILL.md"), "utf8")).toBe(committed);

    const r = await runExperiment(dir, { adapter: a, env: { PATH: "" }, home: root, tmp: root });
    expect(r).toEqual({ ran: 2, remaining: 0 });
    expect(seenArgs.flat()).toContain("--cond=baseline-skill");
  });

  test("a tampered copy is refused, a missing copy is re-extracted", async () => {
    const root = await makeTempDir("bench-exp");
    const a = adapter(async () => ({}));
    await createExperiment(
      {
        id: "b2",
        harness: "claude-code",
        model: "claude-sonnet-5",
        conditions: ["with-skill", "baseline-skill"],
        baseline: "HEAD",
        pairs: 1,
        scenarios: [CLAIM],
        timeoutS: 10,
      },
      deps(a, root),
    );
    const dir = join(root, "b2");
    const copy = join(dir, "baseline-skill");
    await writeFile(join(copy, "SKILL.md"), "tampered\n");
    await expect(
      runExperiment(dir, { adapter: a, env: { PATH: "" }, home: root, tmp: root }),
    ).rejects.toThrow(/baseline skill hash/);
    await rm(copy, { recursive: true, force: true });
    const r = await runExperiment(dir, { adapter: a, env: { PATH: "" }, home: root, tmp: root });
    expect(r).toEqual({ ran: 2, remaining: 0 });
  });

  test("an id outside the experiments root is refused; an existing copy is never replaced", async () => {
    const root = await makeTempDir("bench-exp");
    const experiments = join(root, "experiments");
    await mkdir(experiments, { recursive: true });
    const victim = join(root, "victim", "baseline-skill");
    await mkdir(victim, { recursive: true });
    await writeFile(join(victim, "keep.txt"), "keep\n");
    const escaped = join(root, "escaped");
    await mkdir(escaped);
    await writeFile(join(escaped, "keep.txt"), "keep\n");
    await symlink(escaped, join(experiments, "linked"), "dir");
    const a = adapter(async () => ({}));
    const opts = {
      harness: "claude-code" as const,
      model: "m",
      conditions: ["with-skill", "baseline-skill"] as Condition[],
      baseline: "HEAD",
      pairs: 1,
      scenarios: [CLAIM],
      timeoutS: 10,
    };
    await expect(
      createExperiment({ ...opts, id: "../victim" }, deps(a, experiments)),
    ).rejects.toThrow(/experiment id/);
    await expect(createExperiment({ ...opts, id: "linked" }, deps(a, experiments))).rejects.toThrow(
      /already exists/,
    );
    await mkdir(join(experiments, "stale"), { recursive: true });
    await writeFile(join(experiments, "stale", "keep.txt"), "keep\n");
    await expect(createExperiment({ ...opts, id: "stale" }, deps(a, experiments))).rejects.toThrow(
      /already exists/,
    );
    const leftover = join(experiments, "b6", "baseline-skill");
    await mkdir(leftover, { recursive: true });
    await writeFile(join(leftover, "keep.txt"), "keep\n");
    await expect(createExperiment({ ...opts, id: "b6" }, deps(a, experiments))).rejects.toThrow(
      /already exists/,
    );
    expect(await readFile(join(victim, "keep.txt"), "utf8")).toBe("keep\n");
    expect(await readFile(join(escaped, "keep.txt"), "utf8")).toBe("keep\n");
    expect(await readFile(join(leftover, "keep.txt"), "utf8")).toBe("keep\n");
  });

  test("baseline-skill needs --baseline, --baseline needs baseline-skill, and the ref must exist", async () => {
    const root = await makeTempDir("bench-exp");
    const a = adapter(async () => ({}));
    const base = {
      harness: "claude-code" as const,
      model: "m",
      pairs: 1,
      scenarios: [CLAIM],
      timeoutS: 10,
    };
    await expect(
      createExperiment(
        { ...base, id: "b3", conditions: ["with-skill", "baseline-skill"] },
        deps(a, root),
      ),
    ).rejects.toThrow(/needs --baseline/);
    await expect(
      createExperiment(
        { ...base, id: "b4", conditions: ["with-skill", "without-skill"], baseline: "HEAD" },
        deps(a, root),
      ),
    ).rejects.toThrow(/needs --baseline/);
    await expect(
      createExperiment(
        {
          ...base,
          id: "b5",
          conditions: ["with-skill", "baseline-skill"],
          baseline: "no-such-ref-xyz",
        },
        deps(a, root),
      ),
    ).rejects.toThrow(/is not a commit/);
  });
});
