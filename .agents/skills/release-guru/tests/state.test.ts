import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { defaultConfig } from "../scripts/config";
import {
  acquireLock,
  clearState,
  type Evidence,
  freshEvidence,
  pidAlive,
  type ReleaseState,
  readState,
  releaseLock,
  statePaths,
  writeState,
} from "../scripts/state";

async function cfgIn() {
  return { ...defaultConfig(await makeTempDir("state")), slug: "acme/demo" };
}

function state(over: Partial<ReleaseState> = {}): ReleaseState {
  return {
    schema: 1,
    repo: "acme/demo",
    kind: "release",
    version: "0.10.1",
    previousTag: "v0.10.0",
    branch: "release/v0.10.1",
    commit: "c1",
    tree: "t1",
    phase: "prepared",
    blockers: [],
    evidence: [],
    publish: {},
    verify: [],
    updatedAt: "",
    ...over,
  };
}

const ev = (check: Evidence["check"], tree: string, finishedAt: string): Evidence => ({
  check,
  command: ["x"],
  commit: "c1",
  tree,
  tools: {},
  result: "pass",
  detail: finishedAt,
  startedAt: finishedAt,
  finishedAt,
});

test("statePaths live under the state dir", async () => {
  const cfg = await cfgIn();
  const p = statePaths(cfg);
  expect(p.dir).toBe(join(cfg.root, ".release-guru"));
  expect(p.state).toBe(join(p.dir, "state.json"));
  expect(p.agentHistory).toBe(join(p.dir, "agent-e2e", "history.jsonl"));
  expect(p.agentReport).toBe(join(p.dir, "agent-e2e", "report.md"));
});

test("writeState then readState round-trips and leaves no temp file", async () => {
  const cfg = await cfgIn();
  expect(await readState(cfg)).toBeNull();
  await writeState(cfg, state(), new Date("2026-11-02T10:00:00Z"));
  expect(await readState(cfg)).toEqual(state({ updatedAt: "2026-11-02T10:00:00.000Z" }));
  expect(readdirSync(statePaths(cfg).dir)).toEqual(["state.json"]);
});

test("readState refuses another repo's or another schema's state", async () => {
  const cfg = await cfgIn();
  await writeState(cfg, state({ repo: "other/repo" }));
  await expect(readState(cfg)).rejects.toThrow(/belongs to other\/repo/);
  await writeState(cfg, { ...state(), schema: 2 } as unknown as ReleaseState);
  await expect(readState(cfg)).rejects.toThrow(/schema/);
});

test("clearState removes everything in the state dir but a held lock", async () => {
  const cfg = await cfgIn();
  await writeState(cfg, state());
  writeFileSync(statePaths(cfg).notes, "n\n");
  await clearState(cfg);
  expect(existsSync(statePaths(cfg).dir)).toBe(false);
  await writeState(cfg, state());
  expect(await acquireLock(cfg, "prepare")).toEqual({ ok: true });
  await clearState(cfg);
  expect(readdirSync(statePaths(cfg).dir)).toEqual(["lock"]);
});

test("freshEvidence takes the newest entry per check for the current tree", () => {
  const s = state({
    evidence: [
      ev("gate", "t1", "2026-11-02T01:00:00Z"),
      ev("gate", "t1", "2026-11-02T02:00:00Z"),
      ev("gate", "t0", "2026-11-02T03:00:00Z"),
      ev("agents", "t0", "2026-11-02T03:00:00Z"),
    ],
  });
  const fresh = freshEvidence(s);
  expect(fresh.gate?.finishedAt).toBe("2026-11-02T02:00:00Z");
  expect(fresh.agents).toBeUndefined();
});

test("the lock admits one holder and names it", async () => {
  const cfg = await cfgIn();
  const sleeper = Bun.spawn(["sleep", "30"]);
  try {
    expect(await acquireLock(cfg, "publish", sleeper.pid)).toEqual({ ok: true });
    const second = await acquireLock(cfg, "prepare");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.holder).toMatch(new RegExp(`publish.*pid ${sleeper.pid}`));
    await releaseLock(cfg);
    expect(existsSync(statePaths(cfg).lock)).toBe(false);
  } finally {
    sleeper.kill();
  }
});

test("a lock held by a dead pid is replaced", async () => {
  const cfg = await cfgIn();
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  expect(pidAlive(dead.pid)).toBe(false);
  mkdirSync(statePaths(cfg).dir, { recursive: true });
  const { hostname } = await import("node:os");
  writeFileSync(
    statePaths(cfg).lock,
    JSON.stringify({ pid: dead.pid, command: "check", host: hostname(), startedAt: "x" }),
  );
  expect(await acquireLock(cfg, "prepare")).toEqual({ ok: true });
});
