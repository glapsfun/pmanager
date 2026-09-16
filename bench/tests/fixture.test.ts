import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { headSha, linkSkill, lsRemoteRefs } from "../fixture";
import { SKILL_DIR } from "../skill-paths";

describe("fixture helpers", () => {
  test("linkSkill copies the skill to both paths without node_modules and excludes them", async () => {
    const dir = await makeTempDir("bench-fixture");
    await buildWebshopRepo(dir);
    await linkSkill(dir, SKILL_DIR);
    for (const rel of [".agents/skills/pmanager", ".claude/skills/pmanager"]) {
      const p = join(dir, rel);
      expect((await stat(p)).isSymbolicLink()).toBe(false);
      expect((await stat(join(p, "SKILL.md"))).isFile()).toBe(true);
      expect((await stat(join(p, "scripts", "pm.ts"))).isFile()).toBe(true);
      await expect(stat(join(p, "node_modules"))).rejects.toThrow();
    }
    const exclude = await readFile(join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".agents/\n");
    expect(exclude).toContain(".claude/\n");
    expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
  });

  test("headSha and lsRemoteRefs", async () => {
    const dir = await makeTempDir("bench-fixture");
    await buildWebshopRepo(dir);
    expect(await headSha(dir)).toMatch(/^[0-9a-f]{40}$/);
    const bare = await makeTempDir("bench-bare");
    await gitOk(["init", "-q", "--bare", "-b", "main"], bare);
    await gitOk(["remote", "add", "origin", bare], dir);
    await gitOk(["push", "-q", "origin", "main"], dir);
    const refs = await lsRemoteRefs(dir, "origin");
    expect(Object.keys(refs)).toEqual(["refs/heads/main"]);
    expect(refs["refs/heads/main"]).toBe(await headSha(dir));
  });
});
