import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig, REPO_ROOT } from "../scripts/config";

test("defaultConfig points at this repo", () => {
  const c = defaultConfig();
  expect(c.root).toBe(REPO_ROOT);
  expect(c.slug).toBe("glapsfun/pmanager");
  for (const m of c.manifests) expect(existsSync(join(c.root, m))).toBe(true);
  expect(existsSync(join(c.root, c.marketplace))).toBe(true);
  expect(c.originPattern.test("git@github.com:glapsfun/pmanager.git")).toBe(true);
  expect(c.originPattern.test("https://github.com/glapsfun/pmanager")).toBe(true);
  expect(c.originPattern.test("https://github.com/someone/pmanager")).toBe(false);
  expect(c.requiredChecks).toEqual([
    "lint",
    "typecheck",
    "test",
    "manifest",
    "audit",
    "e2e",
    "commits",
  ]);
});

test("defaultConfig takes another root", () => {
  expect(defaultConfig("/tmp/x").root).toBe("/tmp/x");
});
