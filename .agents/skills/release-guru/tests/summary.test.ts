import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { cmdPrepare } from "../scripts/prepare";
import { AGENT_RUN_FAILED, readState, statePaths, writeState } from "../scripts/state";
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

test("a skipped agent e2e shows in the summary and the PR body and does not block", async () => {
  const { f } = await checked();
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const evidence = s.evidence.map((e) =>
    e.check === "agents" ? { ...e, result: "skipped" as const } : e,
  );
  await writeState(f.cfg, { ...s, evidence });
  const r = await cmdSummary(testCtx(f));
  expect(r.code).toBe(0);
  expect(r.blockers).toBeUndefined();
  expect(String(r.data?.summary)).toMatch(/\| agents \| skipped \| [0-9a-f]{7} \|/);
  expect(prBody({ ...s, evidence }, "## Fixed\n\n- a fix (#1)\n")).toContain(
    "| agents | skipped |",
  );
});

test("a failed agent e2e still blocks", async () => {
  const { f } = await checked();
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const evidence = s.evidence.map((e) =>
    e.check === "agents" ? { ...e, result: "fail" as const } : e,
  );
  await writeState(f.cfg, { ...s, evidence });
  expect((await cmdSummary(testCtx(f))).blockers).toEqual([AGENT_RUN_FAILED]);
});

test("a later check without --agent-e2e does not hide a failed paid run on the same tree", async () => {
  const { f } = await checked();
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const failed = s.evidence.find((e) => e.check === "agents");
  if (!failed) throw new Error("no agents evidence");
  const skipped = {
    ...failed,
    result: "skipped" as const,
    finishedAt: "2026-11-02T11:00:00Z",
  };
  const evidence = [
    ...s.evidence.filter((e) => e !== failed),
    { ...failed, result: "fail" as const },
    skipped,
  ];
  await writeState(f.cfg, { ...s, evidence });
  expect((await cmdSummary(testCtx(f))).blockers).toEqual([AGENT_RUN_FAILED]);
  const passedLater = [
    ...evidence,
    { ...failed, finishedAt: "2026-11-02T12:00:00Z" },
    {
      ...skipped,
      finishedAt: "2026-11-02T13:00:00Z",
    },
  ];
  await writeState(f.cfg, { ...s, evidence: passedLater });
  expect((await cmdSummary(testCtx(f))).code).toBe(0);
});

test("a paid run that passed stays in the table and the PR body after a plain check", async () => {
  const { f } = await checked();
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const paid = s.evidence.find((e) => e.check === "agents");
  if (!paid) throw new Error("no agents evidence");
  const ran = { ...paid, detail: "claude-code feature-idea-epic 3/3 PASS\nagent e2e: PASS" };
  const skipped = { ...paid, result: "skipped" as const, finishedAt: "2026-11-02T11:00:00Z" };
  const evidence = [...s.evidence.filter((e) => e !== paid), ran, skipped];
  await writeState(f.cfg, { ...s, evidence });
  const text = String((await cmdSummary(testCtx(f))).data?.summary);
  expect(text).toMatch(/\| agents \| pass \|/);
  expect(text).not.toContain("not run: check ran without --agent-e2e");
  const body = prBody({ ...s, evidence }, "## Fixed\n\n- a fix (#1)\n");
  expect(body).toMatch(/\| agents \| pass \|/);
  expect(body).toContain("claude-code feature-idea-epic 3/3 PASS");
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

test("the PR body keeps each harness's agent e2e verdict, report-only and unavailable ones included", async () => {
  const { f } = await checked();
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  const detail = [
    "run 1 of 3 ...",
    "claude-code feature-idea-epic 2/3 PASS",
    "codex feature-idea-epic 0/3 FAIL [report-only]",
    "codex unavailable [report-only]",
    "agent e2e: PASS",
  ].join("\n");
  const evidence = s.evidence.map((e) => (e.check === "agents" ? { ...e, detail } : e));
  const body = prBody({ ...s, evidence }, "## Fixed\n\n- a fix (#1)\n");
  expect(body).toContain(
    [
      "claude-code feature-idea-epic 2/3 PASS",
      "codex feature-idea-epic 0/3 FAIL [report-only]",
      "codex unavailable [report-only]",
      "agent e2e: PASS",
    ].join("\n"),
  );
  expect(body).not.toContain("run 1 of 3");
});
