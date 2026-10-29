import { expect, test } from "bun:test";
import { isolatedEnv } from "../e2e/isolated-env";
import { capture } from "../proc";

test("capture with inherit false passes only the given environment", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sentinel";
  try {
    const cmd = ["bun", "-e", "console.log(process.env.ANTHROPIC_API_KEY ?? 'none')"];
    const env = isolatedEnv("/tmp/iso");
    expect((await capture(cmd, "/tmp", env, false)).stdout.trim()).toBe("none");
    expect((await capture(cmd, "/tmp", env)).stdout.trim()).toBe("sentinel");
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});
