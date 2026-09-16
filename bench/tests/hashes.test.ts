import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { linkSkill } from "../fixture";
import { hashFixture, hashSkill, hashString, hashTree } from "../hashes";
import { SKILL_DIR } from "../skill-paths";

describe("hashes", () => {
  test("hashString is stable and prefixed", () => {
    expect(hashString("a")).toBe(hashString("a"));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("a").startsWith("sha256:")).toBe(true);
  });

  test("hashTree depends on paths and contents, not on skipped dirs", async () => {
    const a = await makeTempDir("bench-hash");
    await mkdir(join(a, "sub"), { recursive: true });
    await writeFile(join(a, "sub", "x.txt"), "1\n");
    const h1 = await hashTree(a, new Set(["node_modules"]));
    await mkdir(join(a, "node_modules"), { recursive: true });
    await writeFile(join(a, "node_modules", "y.txt"), "ignored\n");
    expect(await hashTree(a, new Set(["node_modules"]))).toBe(h1);
    await writeFile(join(a, "sub", "x.txt"), "2\n");
    expect(await hashTree(a, new Set(["node_modules"]))).not.toBe(h1);
  });

  test("two fixture builds hash equal, and the skill copy does not change the fixture hash", async () => {
    const a = await makeTempDir("bench-hash");
    const b = await makeTempDir("bench-hash");
    await buildWebshopRepo(a);
    await buildWebshopRepo(b);
    const ha = await hashFixture(a);
    expect(await hashFixture(b)).toBe(ha);
    await linkSkill(a, SKILL_DIR);
    expect(await hashFixture(a)).toBe(ha);
    expect((await hashSkill()).startsWith("sha256:")).toBe(true);
  });
});
