import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../packages";
import { capture } from "../proc";
import versions from "../tool-versions.json";
import { isolatedEnv } from "./isolated-env";

const PLUGIN_DIR = join(REPO_ROOT, "plugins", "pmanager");
const version: string = JSON.parse(
  readFileSync(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8"),
).version;

let tmp: string;
let env: Record<string, string>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "plugin-install-"));
  env = isolatedEnv(tmp);
  for (const dir of [env.HOME, env.CLAUDE_CONFIG_DIR, env.CODEX_HOME])
    mkdirSync(dir, { recursive: true });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function requireCli(bin: string, pkg: string, v: string): void {
  if (!Bun.which(bin)) throw new Error(`${bin} CLI not found: npm install -g ${pkg}@${v}`);
}

test("Claude Code installs and loads pmanager from this repo", async () => {
  requireCli("claude", "@anthropic-ai/claude-code", versions["claude-code"]);
  const run = (...args: string[]) => capture(["claude", ...args], tmp, env, false);

  const added = await run("plugin", "marketplace", "add", REPO_ROOT, "--json");
  expect(added.code).toBe(0);
  const last = added.stdout.trim().split("\n").at(-1) ?? "";
  expect(JSON.parse(last).outcome).toBe("ok");

  const installed = await run("plugin", "install", "pmanager@pmanager");
  expect(installed.code).toBe(0);

  const listed = await run("plugin", "list", "--json");
  expect(listed.code).toBe(0);
  const entry = (
    JSON.parse(listed.stdout) as {
      id: string;
      enabled: boolean;
      version: string;
      installPath: string;
    }[]
  ).find((p) => p.id === "pmanager@pmanager");
  expect(entry?.enabled).toBe(true);
  expect(entry?.version).toBeTruthy();
  const root = entry?.installPath ?? "";
  for (const rel of [
    "skills/pmanager/SKILL.md",
    "skills/pmanager/scripts/pm.ts",
    "commands/pmanager.md",
  ]) {
    expect(existsSync(join(root, rel))).toBe(true);
  }

  const pm = await capture(
    ["bun", "run", join(root, "skills/pmanager/scripts/pm.ts")],
    tmp,
    env,
    false,
  );
  expect(pm.code).toBe(2);
  expect(pm.stdout + pm.stderr).toContain("usage: bun run scripts/pm.ts");
}, 120000);

test("Codex installs and loads pmanager from this repo", async () => {
  requireCli("codex", "@openai/codex", versions.codex);
  const run = (...args: string[]) => capture(["codex", ...args], tmp, env, false);

  expect((await run("plugin", "marketplace", "add", REPO_ROOT)).code).toBe(0);
  expect((await run("plugin", "add", "pmanager@pmanager")).code).toBe(0);

  const listed = await run("plugin", "list", "-m", "pmanager");
  expect(listed.stdout).toMatch(
    new RegExp(`pmanager@pmanager\\s+installed, enabled\\s+${version}`),
  );
  expect(
    existsSync(
      join(
        env.CODEX_HOME,
        "plugins",
        "cache",
        "pmanager",
        "pmanager",
        version,
        "skills",
        "pmanager",
        "SKILL.md",
      ),
    ),
  ).toBe(true);
}, 120000);
