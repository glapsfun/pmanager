import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { cmdPrepare } from "../scripts/prepare";
import { readState, statePaths, writeState } from "../scripts/state";
import { cmdSummary, prBody } from "../scripts/summary";
import { testCtx } from "./ctx";
import { commitAndPush, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";

async function checked() {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await cmdPrepare(testCtx(f), {});
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const ev = (check: "gate" | "agents") => ({
    check,
    command: ["x"],
    commit: s.commit,
    tree: s.tree,
    tools: { bun: "1.4.2" },
    result: "pass" as const,
    detail: `${check} output`,
    startedAt: "2026-11-02T10:00:00Z",
    finishedAt: "2026-11-02T10:05:00Z",
  });
  await writeState(f.cfg, { ...s, phase: "checked", evidence: [ev("gate"), ev("agents")] });
  return { f, tree: s.tree };
}

test("the summary carries version, notes, checks, distribution changes and the publish line", async () => {
  const { f, tree } = await checked();
  const r = await cmdSummary(testCtx(f));
  expect(r.code).toBe(0);
  const text = String(r.data?.summary);
  expect(readFileSync(statePaths(f.cfg).summary, "utf8")).toBe(text);
  expect(text).toContain("# pmanager v0.10.1 release candidate");
  expect(text).toContain("previous: v0.10.0");
  expect(text).toContain(tree);
  expect(text).toContain("- a fix (");
  expect(text).toMatch(/\| gate \| pass \| [0-9a-f]{7} \|/);
  expect(text).toMatch(/\| agents \| pass \| [0-9a-f]{7} \|/);
  expect(text).toContain(
    ".claude-plugin/plugin.json and plugins/pmanager/.codex-plugin/plugin.json: 0.10.0 to 0.10.1",
  );
  expect(text).toContain("marketplace.json: unchanged since v0.10.0");
  expect(text).toContain("## Blockers\n\n- none");
  expect(text.trimEnd().endsWith(`To publish: bun run release publish --tree ${tree}`)).toBe(true);
});

test("a TODO in the notes and missing checks show as blockers", async () => {
  const { f } = await checked();
  writeFileSync(statePaths(f.cfg).notes, "## Fixed\n\n- TODO: say it (#1)\n");
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  await writeState(f.cfg, { ...s, evidence: [] });
  const r = await cmdSummary(testCtx(f));
  expect(r.code).toBe(1);
  expect(r.blockers).toEqual([
    "notes still contain a TODO: - TODO: say it (#1)",
    "gate has not passed for this tree",
    "agent e2e has not passed for this tree",
  ]);
  expect(String(r.data?.summary)).toContain("| gate | not run |");
});

test("the PR body is the notes plus the checks table", async () => {
  const { f } = await checked();
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const body = prBody(s, "## Fixed\n\n- a fix (#1)\n");
  expect(body.startsWith("## Fixed\n\n- a fix (#1)\n\n## Release checks\n")).toBe(true);
  expect(body).toMatch(/\| gate \| pass \|/);
  expect(body).not.toContain("gate output");
});
