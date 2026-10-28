import { expect, test } from "bun:test";
import { isolatedEnv } from "../e2e/isolated-env";

test("isolatedEnv overrides inherited config paths and drops API keys", () => {
  const tmp = "/tmp/iso";
  const env = isolatedEnv(tmp, {
    HOME: "/real",
    CLAUDE_CONFIG_DIR: "/real/claude",
    CODEX_HOME: "/real/codex",
    ANTHROPIC_API_KEY: "x",
    OPENAI_API_KEY: "y",
    PATH: "/usr/bin",
  });
  expect(env.HOME.startsWith(tmp)).toBe(true);
  expect(env.CLAUDE_CONFIG_DIR.startsWith(tmp)).toBe(true);
  expect(env.CODEX_HOME.startsWith(tmp)).toBe(true);
  expect("ANTHROPIC_API_KEY" in env).toBe(false);
  expect("OPENAI_API_KEY" in env).toBe(false);
  expect(env.PATH).toBe("/usr/bin");
});
