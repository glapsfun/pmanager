import { expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../scripts/config";
import { USAGE } from "../scripts/release";

const PKG = join(import.meta.dir, "..");
const SKILL = join(PKG, "SKILL.md");
const RUNBOOK = join(REPO_ROOT, "RELEASING.md");
const EM_DASH = String.fromCodePoint(0x2014);
const COMMANDS = USAGE.split("\n")
  .slice(1)
  .map((l) => l.trim().split(" ")[0] as string);

test("SKILL.md has the frontmatter Codex requires", () => {
  const text = readFileSync(SKILL, "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  expect(/^name: release-guru$/m.test(front)).toBe(true);
  expect(/^description: \S.{40,}$/m.test(front)).toBe(true);
});

test("the skill and the runbook cover every command", () => {
  expect(COMMANDS).toHaveLength(9);
  for (const file of [SKILL, RUNBOOK]) {
    const text = readFileSync(file, "utf8");
    for (const c of COMMANDS) expect(text, `${file} ${c}`).toContain(`bun run release ${c}`);
  }
});

test("Claude Code reaches the same skill through .claude/skills", () => {
  const link = join(REPO_ROOT, ".claude", "skills", "release-guru");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(realpathSync(link)).toBe(realpathSync(PKG));
});

test("the docs use no em dash", () => {
  for (const file of [SKILL, RUNBOOK]) {
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8").includes(EM_DASH), file).toBe(false);
  }
});

test("SKILL.md tells agents how to stay inside their shell timeout", () => {
  const text = readFileSync(SKILL, "utf8");
  expect(text).toContain("bun run release wait --timeout");
  expect(text).toContain("--wait");
  expect(text).toContain("shell timeout");
});

test("RELEASING.md covers the stuck cases", () => {
  const text = readFileSync(RUNBOOK, "utf8");
  for (const phrase of [
    "## When a release is stuck",
    "taken on origin",
    "main carries",
    "GitHub blocks the merge",
    "verify has not run",
  ]) {
    expect(text, phrase).toContain(phrase);
  }
});
