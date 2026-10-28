import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../packages";
import { capture } from "../proc";

const SHIMS: Record<string, string> = {
  "pre-commit": 'exec bun "$(dirname "$0")/../gate.ts" pre-commit',
  "commit-msg": 'exec bun "$(dirname "$0")/../gate.ts" commit-msg "$1"',
  "pre-push": 'exec bun "$(dirname "$0")/../gate.ts" pre-push --hook "$@"',
};

test("hook shims call the gate and are executable", () => {
  for (const [name, line] of Object.entries(SHIMS)) {
    const file = join(REPO_ROOT, "ci", "hooks", name);
    expect(statSync(file).mode & 0o111).not.toBe(0);
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines).toEqual(["#!/bin/sh", line]);
  }
});

test("commit-msg hook rejects a bad subject and accepts a good one in a real repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hooks-"));
  try {
    const git = (...args: string[]) => capture(["git", ...args], dir);
    await git("init", "-q");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.com");
    await git("config", "commit.gpgsign", "false");
    await git("config", "core.hooksPath", join(REPO_ROOT, "ci", "hooks"));
    const bad = await git("commit", "--allow-empty", "-m", "wip: x");
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain("unknown type");
    const good = await git("commit", "--allow-empty", "-m", "fix: ok");
    expect(good.code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
