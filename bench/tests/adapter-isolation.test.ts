import { describe, expect, test } from "bun:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { claudeCode } from "../adapters/claude-code";
import { codex } from "../adapters/codex";
import { pi } from "../adapters/pi";

async function fakeHome() {
  const home = await makeTempDir("bench-home");
  await mkdir(join(home, ".claude", "skills", "sentinel"), { recursive: true });
  await writeFile(
    join(home, ".claude", ".credentials.json"),
    '{"claudeAiOauth":{"accessToken":"x"}}',
  );
  await writeFile(join(home, ".claude", "settings.json"), '{"enabledPlugins":{"sentinel":true}}');
  await mkdir(join(home, ".codex", "skills", "sentinel"), { recursive: true });
  await writeFile(join(home, ".codex", "auth.json"), '{"OPENAI_API_KEY":"x"}');
  await mkdir(join(home, ".agents", "skills", "sentinel"), { recursive: true });
  return home;
}

describe("adapter isolation", () => {
  test("claude-code: temp config dir holds only credentials", async () => {
    const home = await fakeHome();
    const iso = await claudeCode.isolate({ home, tmp: await makeTempDir("bench-iso") });
    expect(iso?.mode).toBe("config-dir");
    const cfg = iso?.env.CLAUDE_CONFIG_DIR as string;
    expect(cfg.startsWith(home)).toBe(false);
    expect((await stat(join(cfg, ".credentials.json"))).isFile()).toBe(true);
    await expect(stat(join(cfg, "skills"))).rejects.toThrow();
    await expect(stat(join(cfg, "settings.json"))).rejects.toThrow();
    expect(iso?.args("with-skill", "/f")).toEqual([]);
    expect(iso?.args("without-skill", "/f")).toEqual([]);
    await iso?.cleanup();
    await expect(stat(cfg)).rejects.toThrow();
  });

  test("claude-code: no credentials file and no API key means no isolation", async () => {
    const home = await makeTempDir("bench-home");
    const tmp = await makeTempDir("bench-iso");
    expect(await claudeCode.isolate({ home, tmp, env: {} })).toBeNull();
  });

  test("claude-code and codex: an API key alone yields an empty isolated config", async () => {
    const home = await makeTempDir("bench-home");
    const tmp = await makeTempDir("bench-iso");
    const c = await claudeCode.isolate({ home, tmp, env: { ANTHROPIC_API_KEY: "k" } });
    expect(c?.mode).toBe("config-dir");
    await expect(
      stat(join(c?.env.CLAUDE_CONFIG_DIR as string, ".credentials.json")),
    ).rejects.toThrow();
    const x = await codex.isolate({ home, tmp, env: { OPENAI_API_KEY: "k" } });
    expect(x?.mode).toBe("home-dir");
    await expect(stat(join(x?.env.CODEX_HOME as string, "auth.json"))).rejects.toThrow();
    expect(await codex.isolate({ home, tmp, env: {} })).toBeNull();
  });

  test("codex: temp HOME and CODEX_HOME hold only auth.json", async () => {
    const home = await fakeHome();
    const iso = await codex.isolate({ home, tmp: await makeTempDir("bench-iso") });
    expect(iso?.mode).toBe("home-dir");
    const h = iso?.env.HOME as string;
    const ch = iso?.env.CODEX_HOME as string;
    expect(h.startsWith(home)).toBe(false);
    expect((await stat(join(ch, "auth.json"))).isFile()).toBe(true);
    await expect(stat(join(h, ".agents"))).rejects.toThrow();
    await expect(stat(join(ch, "skills"))).rejects.toThrow();
    expect(iso?.args("with-skill", "/f")).toEqual([]);
  });

  test("pi: flags disable user resources; with-skill loads the fixture copy explicitly", async () => {
    const home = await fakeHome();
    const iso = await pi.isolate({ home, tmp: await makeTempDir("bench-iso") });
    expect(iso?.mode).toBe("flags");
    expect(iso?.env).toEqual({});
    const base = ["--no-skills", "--no-extensions", "--no-prompt-templates", "--no-context-files"];
    expect(iso?.args("without-skill", "/f")).toEqual(base);
    expect(iso?.args("with-skill", "/f")).toEqual([
      ...base,
      "--skill",
      "/f/.agents/skills/pmanager",
    ]);
  });
});
