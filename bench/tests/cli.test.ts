import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { main } from "../bench";
import { parseArgs } from "../cli-args";
import { README_PATH } from "../skill-paths";
import { attempts, manifest } from "./fixtures/experiment-fixture";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

describe("cli-args", () => {
  test("parses run flags with repeated --scenario", () => {
    const a = parseArgs([
      "run",
      "--harness",
      "codex",
      "--model",
      "m",
      "--scenario",
      "a",
      "--scenario",
      "b",
      "--runs",
      "2",
      "--timeout-s",
      "60",
      "--keep",
    ]);
    expect(a).toEqual({
      command: "run",
      harness: "codex",
      model: "m",
      scenarios: ["a", "b"],
      runs: 2,
      timeoutS: 60,
      keep: true,
      epics: 50,
      tasks: 20,
      iterations: 5,
      historyPath: undefined,
      reportPath: undefined,
      rawDir: undefined,
      sub: undefined,
      id: undefined,
      condition: "with-skill",
      pairs: 1,
      reasoning: undefined,
      yes: false,
      experimentsDir: undefined,
    });
  });

  test("tool defaults", () => {
    const a = parseArgs(["tool", "--epics", "3", "--tasks", "4"]);
    expect(a.command).toBe("tool");
    expect(a.epics).toBe(3);
    expect(a.tasks).toBe(4);
    expect(a.iterations).toBe(5);
  });

  test("unknown flag throws", () => {
    expect(() => parseArgs(["run", "--nope"])).toThrow(/unknown flag/);
  });
});

describe("main", () => {
  test("usage error exits 2", async () => {
    const { err, io: i } = io();
    expect(await main([], i)).toBe(2);
    expect(await main(["bogus"], i)).toBe(2);
    expect(err.join("")).toContain("usage:");
  });

  test("run with an unavailable harness exits 1 and explains", async () => {
    const { err, io: i } = io();
    const dir = await makeTempDir("bench-cli");
    const code = await main(
      [
        "run",
        "--harness",
        "copilot",
        "--history",
        join(dir, "h.jsonl"),
        "--report",
        join(dir, "BENCH.md"),
        "--raw-dir",
        join(dir, "raw"),
      ],
      i,
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("not implemented");
  });

  test("tool appends a history line and writes the report", async () => {
    const { out, io: i } = io();
    const dir = await makeTempDir("bench-cli");
    const history = join(dir, "h.jsonl");
    const report = join(dir, "BENCH.md");
    const code = await main(
      [
        "tool",
        "--epics",
        "2",
        "--tasks",
        "2",
        "--iterations",
        "1",
        "--history",
        history,
        "--report",
        report,
      ],
      i,
    );
    expect(code).toBe(0);
    expect((await Bun.file(history).text()).split("\n").filter(Boolean)).toHaveLength(1);
    expect(await Bun.file(report).text()).toContain("## Tool microbench");
    expect(out.join("")).toContain("status");
  });

  test("report renders from an existing history", async () => {
    const { io: i } = io();
    const dir = await makeTempDir("bench-cli");
    const history = join(dir, "h.jsonl");
    const report = join(dir, "BENCH.md");
    expect(await main(["report", "--history", history, "--report", report], i)).toBe(0);
    expect(await Bun.file(report).text()).toContain("_no agent runs recorded_");
  });

  test("overridden history and report paths never touch the root README", async () => {
    const { io: i } = io();
    const before = await Bun.file(README_PATH).text();
    const dir = await makeTempDir("bench-cli");
    const history = join(dir, "h.jsonl");
    const report = join(dir, "BENCH.md");
    await main(
      [
        "tool",
        "--epics",
        "1",
        "--tasks",
        "1",
        "--iterations",
        "1",
        "--history",
        history,
        "--report",
        report,
      ],
      i,
    );
    await main(["report", "--history", history, "--report", report], i);
    expect(await Bun.file(README_PATH).text()).toBe(before);
  });
});

describe("experiment commands", () => {
  test("parseArgs reads experiment flags", () => {
    const a = parseArgs([
      "experiment",
      "new",
      "--id",
      "e1",
      "--harness",
      "pi",
      "--model",
      "m",
      "--condition",
      "both",
      "--pairs",
      "2",
      "--reasoning",
      "high",
      "--experiments-dir",
      "/x",
    ]);
    expect(a).toMatchObject({
      command: "experiment",
      sub: "new",
      id: "e1",
      harness: "pi",
      model: "m",
      condition: "both",
      pairs: 2,
      reasoning: "high",
      experimentsDir: "/x",
    });
    expect(parseArgs(["experiment", "run", "--id", "e1", "--yes"])).toMatchObject({
      sub: "run",
      id: "e1",
      yes: true,
    });
    expect(() => parseArgs(["experiment", "--id", "e1"])).toThrow(/experiment needs/);
    expect(() => parseArgs(["experiment", "new", "--condition", "maybe"])).toThrow(/condition/);
  });

  test("new requires --model and an available harness; run and report need an experiment", async () => {
    const dir = await makeTempDir("bench-cli-exp");
    const { err, out, io: i } = io();
    const base = ["--id", "e", "--harness", "copilot", "--experiments-dir", dir];
    expect(await main(["experiment", "new", ...base], i)).toBe(2);
    expect(err.join("")).toContain("--model");
    expect(await main(["experiment", "new", ...base, "--model", "m"], i)).toBe(1);
    expect(err.join("")).toContain("not implemented");
    expect(await main(["experiment", "run", "--id", "missing", "--experiments-dir", dir], i)).toBe(
      1,
    );
    expect(
      await main(["experiment", "report", "--id", "missing", "--experiments-dir", dir], i),
    ).toBe(1);
    expect(out.join("")).toBe("");
  });

  test("report includes the experiments section when an experiments dir is given", async () => {
    const dir = await makeTempDir("bench-cli-exp");
    const expDir = join(dir, "experiments", "t");
    await mkdir(expDir, { recursive: true });
    await writeFile(join(expDir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(
      join(expDir, "attempts.jsonl"),
      `${attempts.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
    const { io: i } = io();
    const history = join(dir, "h.jsonl");
    const report = join(dir, "BENCH.md");
    const code = await main(
      [
        "report",
        "--history",
        history,
        "--report",
        report,
        "--experiments-dir",
        join(dir, "experiments"),
      ],
      i,
    );
    expect(code).toBe(0);
    expect(await Bun.file(report).text()).toContain("## Experiments");
  });
});
