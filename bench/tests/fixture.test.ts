import { describe, expect, test } from "bun:test";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { headSha, linkSkill, lsRemoteRefs } from "../fixture";
import { SKILL_DIR } from "../skill-paths";

describe("fixture helpers", () => {
  test("linkSkill creates both skill paths and excludes them from git", async () => {
    const dir = await makeTempDir("bench-fixture");
    await buildWebshopRepo(dir);
    await linkSkill(dir, SKILL_DIR);
    for (const rel of [".agents/skills/pmanager", ".claude/skills/pmanager"]) {
      const p = join(dir, rel);
      expect((await lstat(p)).isSymbolicLink()).toBe(true);
      expect(await readlink(p)).toBe(SKILL_DIR);
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
