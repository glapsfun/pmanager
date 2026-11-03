import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOk } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { agentsCmd, cmdCheck, cmdWait, GATE_CMD, runChecks } from "../scripts/checks";
import type { Run } from "../scripts/git";
import { cmdPrepare } from "../scripts/prepare";
import { main, parseArgs, USAGE } from "../scripts/release";
import { AGENT_RUN_FAILED, readState, statePaths, writeState } from "../scripts/state";
import { testCtx } from "./ctx";
import { commitAndPush, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";
type Reply = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Reply => ({ code: 0, stdout, stderr: "" });

async function prepared() {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await cmdPrepare(testCtx(f), {});
  return f;
}

/** Answers tool versions, the gate and agent e2e; records every call with its cwd. */
function fakeRun(
  gate: () => Promise<Reply> | Reply,
  agents: () => Reply = () => ok("agent e2e: PASS\n"),
) {
  const calls: { cmd: string[]; cwd: string }[] = [];
  const run: Run = async (cmd, cwd) => {
    calls.push({ cmd, cwd });
    if (cmd[1] === "--version") return ok(`${cmd[0]} 1.2.3\n`);
    if (cmd.join(" ") === GATE_CMD.join(" ")) return gate();
    if (cmd.includes("agent-e2e")) return agents();
    throw new Error(`unexpected command ${cmd.join(" ")}`);
  };
  return { run, calls };
}

test("without --agent-e2e only the gate runs and the agent e2e is recorded as skipped", async () => {
  const f = await prepared();
  const { run, calls } = fakeRun(() => ok("gate ok\n"));
  const r = await runChecks({ ...testCtx(f), run });
  expect(r).toMatchObject({ code: 0, phase: "checked" });
  expect(calls.some((c) => c.cmd.includes("agent-e2e"))).toBe(false);
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  expect(s.evidence.map((e) => [e.check, e.result, e.tree])).toEqual([
    ["gate", "pass", s.tree],
    ["agents", "skipped", s.tree],
  ]);
  expect(s.evidence[1]?.detail).toBe("not run: check ran without --agent-e2e");
});

test("passing gate and agent e2e mark the candidate checked, tracked files untouched", async () => {
  const f = await prepared();
  const { run, calls } = fakeRun(() => ok("gate ok\n"));
  const r = await runChecks({ ...testCtx(f), run }, { agentE2e: true });
  expect(r).toMatchObject({ code: 0, phase: "checked" });
  const s = await readState(f.cfg);
  if (!s) throw new Error("no state");
  expect(s.phase).toBe("checked");
  expect(s.evidence.map((e) => [e.check, e.result, e.tree])).toEqual([
    ["gate", "pass", s.tree],
    ["agents", "pass", s.tree],
  ]);
  expect(s.evidence[0]?.tools.bun).toBe("bun 1.2.3");
  const agents = calls.find((c) => c.cmd.includes("agent-e2e"));
  expect(agents?.cmd).toEqual(agentsCmd(statePaths(f.cfg)));
  expect(agents?.cwd).toBe(join(f.root, "bench"));
  expect((await gitOk(["status", "--porcelain"], f.root)).trim()).toBe("");
});

test("a failing gate stops before the paid run", async () => {
  const f = await prepared();
  const { run, calls } = fakeRun(() => ({ code: 1, stdout: "✖ test\n", stderr: "" }));
  const r = await runChecks({ ...testCtx(f), run }, { agentE2e: true });
  expect(r.code).toBe(1);
  expect(r.phase).toBe("blocked");
  expect(calls.some((c) => c.cmd.includes("agent-e2e"))).toBe(false);
  expect(r.blockers?.[0]).toContain("gate failed");
});

test("an unavailable blocking harness is recorded as unavailable and blocks", async () => {
  const f = await prepared();
  const { run } = fakeRun(
    () => ok(),
    () => ({ code: 1, stdout: "claude-code unavailable\nagent e2e: FAIL\n", stderr: "" }),
  );
  const r = await runChecks({ ...testCtx(f), run }, { agentE2e: true });
  expect(r.phase).toBe("blocked");
  const s = await readState(f.cfg);
  expect(s?.evidence.find((e) => e.check === "agents")?.result).toBe("unavailable");
  expect(r.blockers).toContain("agent e2e: a blocking harness was unavailable");
});

test("a tree that changes during the checks fails both", async () => {
  const f = await prepared();
  const { run } = fakeRun(async () => {
    writeFileSync(join(f.root, "README.md"), "sneaky\n");
    await gitOk(["commit", "-qam", "docs: sneaky"], f.root);
    return ok();
  });
  const r = await runChecks({ ...testCtx(f), run }, { agentE2e: true });
  expect(r.phase).toBe("blocked");
  const s = await readState(f.cfg);
  expect(s?.evidence.map((e) => [e.result, e.detail])).toEqual([
    ["fail", "tree changed during checks"],
    ["fail", "tree changed during checks"],
  ]);
});

test("a tree change fails the gate but leaves a skipped paid run skipped", async () => {
  const f = await prepared();
  const { run } = fakeRun(async () => {
    writeFileSync(join(f.root, "README.md"), "sneaky\n");
    await gitOk(["commit", "-qam", "docs: sneaky"], f.root);
    return ok();
  });
  const r = await runChecks({ ...testCtx(f), run });
  expect(r.phase).toBe("blocked");
  const s = await readState(f.cfg);
  expect(s?.evidence.map((e) => [e.check, e.result])).toEqual([
    ["gate", "fail"],
    ["agents", "skipped"],
  ]);
});

test("check starts the detached runner and wait reports on it", async () => {
  const f = await prepared();
  const sleeper = Bun.spawn(["sleep", "30"]);
  try {
    const spawned: string[][] = [];
    const ctx = {
      ...testCtx(f),
      spawnDetached: (cmd: string[]) => {
        spawned.push(cmd);
        return sleeper.pid;
      },
    };
    const r = await cmdCheck(ctx, {});
    expect(r).toMatchObject({ code: 3, next: "run wait" });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.at(-1)).toBe("run-checks");
    expect(r.message).toContain("gate only; add --agent-e2e for the paid agent e2e");
    expect((await readState(f.cfg))?.checksPid).toBe(sleeper.pid);
    expect((await cmdWait(ctx, { timeout: 1 })).code).toBe(3);
    const s = await readState(f.cfg);
    if (!s) throw new Error("no state");
    await writeState(f.cfg, { ...s, checksPid: undefined, phase: "checked" });
    expect(await cmdWait(ctx, { timeout: 1 })).toMatchObject({ code: 0, phase: "checked" });
  } finally {
    sleeper.kill();
  }
});

test("check --agent-e2e hands the flag to the detached runner", async () => {
  const f = await prepared();
  const spawned: string[][] = [];
  const ctx = {
    ...testCtx(f),
    spawnDetached: (cmd: string[]) => {
      spawned.push(cmd);
      return -1;
    },
  };
  await cmdCheck(ctx, { agentE2e: true });
  expect(spawned[0]?.slice(-2)).toEqual(["run-checks", "--agent-e2e"]);
});

test("check --foreground runs the checks inline", async () => {
  const f = await prepared();
  const { run, calls } = fakeRun(() => ok());
  const r = await cmdCheck({ ...testCtx(f), run }, { foreground: true });
  expect(r.phase).toBe("checked");
  expect(calls.some((c) => c.cmd.includes("agent-e2e"))).toBe(false);
});

test("check --foreground --agent-e2e runs the paid run inline", async () => {
  const f = await prepared();
  const { run, calls } = fakeRun(() => ok());
  const r = await cmdCheck({ ...testCtx(f), run }, { foreground: true, agentE2e: true });
  expect(r.phase).toBe("checked");
  expect(calls.some((c) => c.cmd.includes("agent-e2e"))).toBe(true);
});

test("the command line passes --agent-e2e to check and to the runner", () => {
  expect(parseArgs(["check", "--agent-e2e", "--foreground"])?.flags).toEqual({
    agentE2e: true,
    foreground: true,
  });
  expect(parseArgs(["run-checks", "--agent-e2e"])?.flags).toEqual({ agentE2e: true });
  expect(USAGE).toContain("check [--agent-e2e] [--foreground]");
});

test("a plain check after a failed paid run on the same tree stays blocked", async () => {
  const f = await prepared();
  const failing = fakeRun(
    () => ok(),
    () => ({ code: 1, stdout: "agent e2e: FAIL\n", stderr: "" }),
  );
  expect((await runChecks({ ...testCtx(f), run: failing.run }, { agentE2e: true })).phase).toBe(
    "blocked",
  );
  const { run } = fakeRun(() => ok());
  const r = await runChecks({ ...testCtx(f), run });
  expect(r).toMatchObject({ code: 1, phase: "blocked", blockers: [AGENT_RUN_FAILED] });
  expect(AGENT_RUN_FAILED).toContain("ask the maintainer");
});

test("the command line hands --agent-e2e through to the checks", async () => {
  for (const [argv, paid] of [
    [["check", "--foreground"], false],
    [["check", "--foreground", "--agent-e2e"], true],
    [["run-checks", "--agent-e2e"], true],
  ] as const) {
    const f = await prepared();
    const { run, calls } = fakeRun(() => ok());
    await main([...argv], { ...testCtx(f), run, out: () => {} });
    expect(
      calls.some((c) => c.cmd.includes("agent-e2e")),
      argv.join(" "),
    ).toBe(paid);
  }
});

test("check refuses when HEAD is not the prepared candidate", async () => {
  const f = await prepared();
  writeFileSync(join(f.root, "README.md"), "late\n");
  await gitOk(["commit", "-qam", "docs: late"], f.root);
  const r = await cmdCheck(testCtx(f), { foreground: true });
  expect(r.code).toBe(1);
  expect(r.message).toContain("HEAD is not the prepared candidate");
});

test("writing commands wait while checks run", async () => {
  const f = await prepared();
  const sleeper = Bun.spawn(["sleep", "30"]);
  try {
    const s = await readState(f.cfg);
    if (!s) throw new Error("no state");
    await writeState(f.cfg, { ...s, checksPid: sleeper.pid });
    const out: string[] = [];
    expect(await main(["abandon"], { ...testCtx(f), out: (x) => out.push(x) })).toBe(1);
    expect(JSON.parse(out.join("")).blockers[0]).toBe(
      `checks are running (pid ${sleeper.pid}): run wait`,
    );
  } finally {
    sleeper.kill();
  }
});

test("a spawn that fails leaves no running checks behind", async () => {
  const f = await prepared();
  const r = await cmdCheck({ ...testCtx(f), spawnDetached: () => -1 }, {});
  expect(r.code).toBe(1);
  expect(r.message).toBe(`could not start the checks; see ${statePaths(f.cfg).log}`);
  expect((await readState(f.cfg))?.checksPid).toBeUndefined();
});
