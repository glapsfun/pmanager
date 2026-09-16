import { describe, expect, test } from "bun:test";
import { check } from "../../plugins/pmanager/skills/pmanager/scripts/check";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { copyFixture, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { scoreChecks } from "../graders/types";
import { readSkillVersion, SKILL_DIR } from "../skill-paths";

describe("scaffold", () => {
  test("imports the skill checker and finds the clean fixture clean", async () => {
    const root = await makeTempDir("bench-scaffold");
    await copyFixture(root);
    expect(check(await loadPmRepo(root), { staleDays: 14, today: "2026-09-15" })).toEqual([]);
    expect(SKILL_DIR.endsWith("plugins/pmanager/skills/pmanager")).toBe(true);
    expect(await readSkillVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("scoreChecks divides by scored checks only", () => {
    const s = scoreChecks([
      { id: "a", kind: "outcome", passed: true, evidence: "" },
      { id: "b", kind: "outcome", passed: false, evidence: "" },
      { id: "c", kind: "outcome", passed: null, evidence: "" },
    ]);
    expect(s.score).toBe(0.5);
    expect(s.failed).toEqual(["b"]);
    expect(s.skipped).toEqual(["c"]);
  });
});
