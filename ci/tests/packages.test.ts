import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingInstall, PACKAGES, REPO_ROOT } from "../packages";

test("PACKAGES lists tool, bench, ci with existing dirs", () => {
  expect(PACKAGES.map((p) => p.name)).toEqual(["tool", "bench", "ci"]);
  for (const p of PACKAGES) {
    expect(existsSync(join(REPO_ROOT, p.dir, "package.json"))).toBe(true);
  }
});

test("missingInstall names packages with no node_modules", async () => {
  const root = mkdtempSync(join(tmpdir(), "ci-pkgs-"));
  mkdirSync(join(root, "a", "node_modules"), { recursive: true });
  mkdirSync(join(root, "b"));
  const missing = await missingInstall(root, [
    { name: "tool", dir: "a" },
    { name: "bench", dir: "b" },
  ]);
  expect(missing).toEqual(["bench"]);
});
