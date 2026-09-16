import { describe, expect, test } from "bun:test";
import { ADAPTERS, adapterByName, HARNESS_NAMES } from "../adapters/registry";

describe("adapter registry", () => {
  test("lists all five harnesses and resolves by name", () => {
    expect(HARNESS_NAMES).toEqual(["claude-code", "codex", "pi", "gemini-cli", "copilot"]);
    expect(ADAPTERS.map((a) => a.name)).toEqual(HARNESS_NAMES);
    expect(adapterByName("pi")?.name).toBe("pi");
    expect(adapterByName("nope")).toBeUndefined();
  });

  test("stub adapters report unavailable with a reason and refuse to run", async () => {
    for (const name of ["gemini-cli", "copilot"]) {
      const a = adapterByName(name);
      const d = await a?.detect();
      expect(d?.available).toBe(false);
      expect(d?.reason).toContain("not implemented");
      await expect(
        a?.run({
          cwd: "/tmp",
          prompt: "x",
          model: undefined,
          timeoutMs: 1,
          env: {},
          rawLogPath: "/tmp/x",
        }),
      ).rejects.toThrow(/not implemented/);
    }
  });
});
