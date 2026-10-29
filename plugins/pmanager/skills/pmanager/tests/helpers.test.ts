import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitOk, initGitRepo, makeTempDir, runPm, unclaimedSeed, writeTree } from "./helpers";

const SLUG = "app-performance";

describe("runPm", () => {
  test("runPm captures output, exit code and restores env", async () => {
    const tmp = await makeTempDir("helpers");
    const write = process.stdout.write;
    const r = await runPm([], tmp, { env: { PM_TEST_X: "1" } });
    expect(r.code).toBe(2);
    expect(r.stdout + r.stderr).toContain("usage: bun run scripts/pm.ts");
    expect(process.env.PM_TEST_X).toBeUndefined();
    expect(process.stdout.write).toBe(write);
  });

  test("runPm feeds stdin to --from -", async () => {
    const root = await makeTempDir("helpers");
    await writeTree(root, await unclaimedSeed());
    await initGitRepo(root);
    await gitOk(["add", "-A"], root);
    await gitOk(["commit", "-q", "-m", "seed"], root);
    const plan = await readFile(
      join(import.meta.dir, "fixtures/webshop", `docs/pm/${SLUG}/plan.md`),
      "utf8",
    );
    const stdin = `<!-- pm:file ${SLUG}/plan.md -->\n${plan.trimEnd()}\n| 2026-09-15 | recorded | test |\n`;
    const r = await runPm(
      ["record", SLUG, "--kind", "spec", "-m", "spec app-performance", "--from", "-"],
      root,
      {
        env: { PM_TODAY: "2026-09-15", PM_HARNESS: "test-harness" },
        stdin,
      },
    );
    expect(r.code).toBe(0);
  });
});
