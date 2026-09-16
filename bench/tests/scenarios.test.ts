import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { SCENARIOS, scenarioByName } from "../scenarios/registry";

describe("scenarios", () => {
  test("registry has the four scenarios with skill-naming prompts", () => {
    expect(SCENARIOS.map((s) => s.name)).toEqual([
      "perf-bug-new-epic",
      "feature-idea-epic",
      "tracking-update-memory",
      "two-session-claim-conflict",
    ]);
    for (const s of SCENARIOS) expect(s.prompt.startsWith("Use the pmanager skill.")).toBe(true);
    expect(scenarioByName("nope")).toBeUndefined();
  });

  test("new-epic fixtures have no docs/pm and a clean tree", async () => {
    for (const name of ["perf-bug-new-epic", "feature-idea-epic"]) {
      const dir = await makeTempDir("bench-scn");
      const info = await scenarioByName(name)?.buildFixture(dir);
      expect(info?.epicSlugsBefore).toEqual([]);
      await expect(stat(join(dir, "docs", "pm"))).rejects.toThrow();
      expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
      expect(info?.baselineSha).toBe((await gitOk(["rev-parse", "HEAD"], dir)).trim());
    }
  });

  test("tracking fixture has the uncommitted profile artifact and ignores it", async () => {
    const dir = await makeTempDir("bench-scn");
    const info = await scenarioByName("tracking-update-memory")?.buildFixture(dir);
    expect(info?.ignorePaths).toEqual(["docs/profile-results.txt"]);
    expect(await Bun.file(join(dir, "docs", "profile-results.txt")).text()).toContain("85%");
    expect(info?.epicSlugsBefore).toEqual(["app-performance"]);
  });

  test("claim-conflict fixture has origin with pm/app-performance", async () => {
    const dir = await makeTempDir("bench-scn");
    const info = await scenarioByName("two-session-claim-conflict")?.buildFixture(dir);
    expect(info?.originBare).toBeTruthy();
    expect(Object.keys(info?.originRefs ?? {}).sort()).toEqual([
      "refs/heads/main",
      "refs/heads/pm/app-performance",
    ]);
    expect(await gitOk(["branch", "-r"], dir)).toContain("origin/pm/app-performance");
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], dir)).trim()).toBe("main");
  });
});
