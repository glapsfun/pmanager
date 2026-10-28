import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { CHECKS, main, runChecks } from "../gate";
import { STAGES } from "../stages";

test("unknown name is usage, exit 2", async () => {
  expect(await main(["nope"])).toBe(2);
});

test("stages run cheap checks first", () => {
  expect(STAGES["pre-push"]).toEqual(["lint", "typecheck", "manifest", "audit", "test", "e2e"]);
  expect(STAGES["pre-commit"]).toEqual(["lint-staged", "typecheck"]);
});

test("a missing install stops with the setup hint", async () => {
  const lines: string[] = [];
  const code = await runChecks(
    ["typecheck"],
    { root: "/nowhere", ci: false, args: [] },
    { missingInstall: async () => ["ci"], err: (s) => lines.push(s) },
  );
  const out = lines.join("\n");
  expect(code).toBe(2);
  expect(out).toContain("run: bun run setup");
  expect(out).not.toContain("tsc");
});

test("the e2e check runs bun test over ci/e2e and reports its exit code", async () => {
  const root = await makeTempDir("gate-e2e");
  await mkdir(join(root, "ci", "e2e"), { recursive: true });
  const spec = join(root, "ci", "e2e", "x.test.ts");
  const ctx = { root, ci: false, args: [] };
  await writeFile(spec, 'import { test } from "bun:test";\ntest("ok", () => {});\n');
  expect(await CHECKS.e2e?.(ctx)).toBe(true);
  await writeFile(
    spec,
    'import { expect, test } from "bun:test";\ntest("no", () => expect(1).toBe(2));\n',
  );
  expect(await CHECKS.e2e?.(ctx)).toBe(false);
});

test("install-clis runs npm install -g with the pinned versions", async () => {
  const calls: string[][] = [];
  const code = await main(["install-clis"], async (cmd) => {
    calls.push(cmd);
    return 0;
  });
  expect(code).toBe(0);
  expect(calls).toEqual([
    ["npm", "install", "-g", "@anthropic-ai/claude-code@2.1.312", "@openai/codex@0.165.0"],
  ]);
});
