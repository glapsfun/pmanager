import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
} from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import { main, USAGE } from "../scripts/release";
import { acquireLock, releaseLock } from "../scripts/state";
import { testCtx } from "./ctx";
import { commitAndPush, makeFixture } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";

function capture() {
  const lines: string[] = [];
  return { out: (s: string) => lines.push(s), json: () => JSON.parse(lines.join("")) };
}

test("USAGE names every command", () => {
  for (const c of [
    "status",
    "prepare",
    "check",
    "wait",
    "summary",
    "publish",
    "verify",
    "abandon",
    "baseline",
  ]) {
    expect(USAGE).toContain(c);
  }
});

test("an unknown command or flag is a usage error", async () => {
  const f = await makeFixture();
  for (const argv of [["nope"], ["status", "--bogus"], ["prepare", "--version"], ["publish"], []]) {
    const o = capture();
    expect(await main(argv, { ...testCtx(f), out: o.out })).toBe(2);
    expect(o.json().message).toContain("usage:");
  }
});

test("main prints one JSON result and returns its code", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  const o = capture();
  expect(await main(["prepare"], { ...testCtx(f), out: o.out })).toBe(0);
  expect(o.json()).toMatchObject({ code: 0, phase: "prepared", data: { version: "0.10.1" } });
});

test("main ignores a hook's GIT_DIR and acts on its own repo", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { [SKILL]: "x\n" }, "fix(pm): a fix");
  await main(["prepare"], { ...testCtx(f), out: () => {} });
  const other = await makeTempDir("other");
  await initGitRepo(other);
  process.env.GIT_DIR = join(other, ".git");
  try {
    const o = capture();
    expect(await main(["status"], { ...testCtx(f), out: o.out })).toBe(0);
    expect(o.json().blockers ?? []).toEqual([]);
    expect(process.env.GIT_DIR).toBeUndefined();
  } finally {
    delete process.env.GIT_DIR;
  }
});

test("a held lock blocks a writing command and names the holder", async () => {
  const f = await makeFixture();
  const sleeper = Bun.spawn(["sleep", "30"]);
  try {
    await acquireLock(f.cfg, "publish", sleeper.pid);
    const o = capture();
    expect(await main(["prepare"], { ...testCtx(f), out: o.out })).toBe(1);
    expect(o.json().blockers[0]).toMatch(
      new RegExp(`another release-guru command is running: publish \\(pid ${sleeper.pid}`),
    );
  } finally {
    sleeper.kill();
    await releaseLock(f.cfg);
  }
});

test("the real spawnDetached runs a command into a log and returns its pid", async () => {
  const { realCtx } = await import("../scripts/release");
  const dir = await makeTempDir("spawn");
  const log = join(dir, "sub", "out.log");
  const pid = realCtx().spawnDetached(["sh", "-c", "echo detached"], dir, log);
  expect(pid).toBeGreaterThan(0);
  for (let i = 0; i < 50 && !readFileSync(log, "utf8").includes("detached"); i++) {
    await Bun.sleep(20);
  }
  expect(readFileSync(log, "utf8")).toBe("detached\n");
  expect(await gitOk(["--version"], dir)).toContain("git");
});
