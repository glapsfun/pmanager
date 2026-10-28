import { expect, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { CHECKS, e2eCheck, main, runChecks } from "../gate";
import { capture } from "../proc";
import { STAGES } from "../stages";

test("unknown name is usage, exit 2, and usage lists every check", async () => {
  const lines: string[] = [];
  const error = spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));
  try {
    expect(await main(["nope"])).toBe(2);
    expect(await main(["toString"])).toBe(2);
    expect(await main(["constructor"])).toBe(2);
  } finally {
    error.mockRestore();
  }
  const usage = lines.find((l) => l.startsWith("usage:")) ?? "";
  for (const name of Object.keys(CHECKS)) expect(usage).toContain(`|${name}|`);
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
  const quiet = async (cmd: string[], cwd: string) => (await capture(cmd, cwd)).code;
  expect(CHECKS.e2e).toBe(e2eCheck);
  await writeFile(spec, 'import { test } from "bun:test";\ntest("ok", () => {});\n');
  expect(await e2eCheck(ctx, quiet)).toBe(true);
  await writeFile(
    spec,
    'import { expect, test } from "bun:test";\ntest("no", () => expect(1).toBe(2));\n',
  );
  expect(await e2eCheck(ctx, quiet)).toBe(false);
});

test("install-clis runs npm install -g with the pinned versions", async () => {
  const calls: string[][] = [];
  const code = await main(["install-clis"], {
    run: async (cmd) => {
      calls.push(cmd);
      return 0;
    },
  });
  expect(code).toBe(0);
  expect(calls).toEqual([
    ["npm", "install", "-g", "@anthropic-ai/claude-code@2.1.312", "@openai/codex@0.165.0"],
  ]);
});
