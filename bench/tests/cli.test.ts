import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { main } from "../bench";
import { parseArgs } from "../cli-args";
import { README_PATH } from "../skill-paths";

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
