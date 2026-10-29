import { expect, test } from "bun:test";
import { isolatedEnv } from "../e2e/isolated-env";

test("isolatedEnv keeps PATH and locale, points config at tmp and drops everything else", () => {
  const tmp = "/tmp/iso";
  const env = isolatedEnv(tmp, {
    HOME: "/real",
    CLAUDE_CONFIG_DIR: "/real/claude",
    CODEX_HOME: "/real/codex",
    XDG_CONFIG_HOME: "/real/.config",
    ANTHROPIC_API_KEY: "x",
    ANTHROPIC_AUTH_TOKEN: "x",
    CLAUDE_CODE_OAUTH_TOKEN: "x",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDECODE: "1",
    AWS_ACCESS_KEY_ID: "x",
    OPENAI_API_KEY: "y",
    CODEX_API_KEY: "y",
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
  });
  expect(env).toEqual({
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
    HOME: "/tmp/iso/home",
    CLAUDE_CONFIG_DIR: "/tmp/iso/claude",
    CODEX_HOME: "/tmp/iso/codex",
  });
});
