import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { check } from "../../plugins/pmanager/skills/pmanager/scripts/check";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { CHECK_OPTS } from "../graders/context";
import { generatePmRepo } from "../microbench/generate";
import { median, runMicrobench, toToolLine } from "../microbench/run";

describe("microbench", () => {
  test("generated docs/pm passes the checker with zero errors", async () => {
    const root = await makeTempDir("bench-micro");
    await generatePmRepo(root, { epics: 3, tasks: 4 });
    const repo = await loadPmRepo(root);
    expect(repo.epics).toHaveLength(3);
    expect(repo.epics[0]?.tasks).toHaveLength(4);
    expect(check(repo, CHECK_OPTS).filter((f) => f.severity === "error")).toEqual([]);
    expect(await readdir(join(root, "docs", "pm", "log"))).toHaveLength(3);
    expect(repo.index).toContain("| 0/4 |");
  });

  test("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  test("runMicrobench returns timings and a history line", async () => {
    const r = await runMicrobench({ epics: 2, tasks: 3, iterations: 2 });
    expect(r.epics).toBe(2);
    expect(r.tasks).toBe(6);
    expect(r.iterations).toBe(2);
    for (const k of ["statusMs", "checkMs", "renderMs"] as const) {
      expect(r[k].median).toBeGreaterThanOrEqual(0);
      expect(r[k].max).toBeGreaterThanOrEqual(r[k].median);
    }
    const line = toToolLine(r, { sha: "abc1234", skillVersion: "0.2.0" });
    expect(line.kind).toBe("tool");
    expect(line.tasks).toBe(6);
  });
});
