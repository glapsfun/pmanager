import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOk, makeTempDir } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { Route } from "../scripts/context";
import type { Run } from "../scripts/git";
import { type ReleaseState, readState, statePaths, writeState } from "../scripts/state";
import {
  claudeRoute,
  cmdVerify,
  codexRoute,
  compareToTag,
  githubRoute,
  gskillRoute,
} from "../scripts/verify";
import { testCtx } from "./ctx";
import { FakeGitHub } from "./fake-github";
import { type Fixture, makeFixture } from "./fixture";

const NOTES = "## Fixed\n\n- a fix (#1)\n";

/** The fixture's v0.10.0 tag as a published release, with notes and a matching GitHub release. */
async function published() {
  const f = await makeFixture();
  const head = (await gitOk(["rev-parse", "HEAD"], f.root)).trim();
  const s: ReleaseState = {
    schema: 1,
    repo: f.cfg.slug,
    kind: "release",
    version: "0.10.0",
    previousTag: null,
    branch: "release/v0.10.0",
    commit: head,
    tree: (await gitOk(["rev-parse", "HEAD^{tree}"], f.root)).trim(),
    phase: "published",
    blockers: [],
    evidence: [],
    publish: { mergeCommit: head, tagged: true, released: true },
    verify: [],
    updatedAt: "",
  };
  await writeState(f.cfg, s);
  writeFileSync(statePaths(f.cfg).notes, NOTES);
  const gh = new FakeGitHub(f);
  await gh.createRelease("v0.10.0", "v0.10.0", statePaths(f.cfg).notes);
  return { f, s, gh, ctx: testCtx(f, gh) };
}

async function extractPlugin(f: Fixture, dir: string) {
  mkdirSync(dir, { recursive: true });
  const p = Bun.spawn(
    [
      "sh",
      "-c",
      `git -C "${f.root}" archive v0.10.0 plugins/pmanager | tar -x -C "${dir}" --strip-components=2`,
    ],
    { stderr: "inherit" },
  );
  expect(await p.exited).toBe(0);
}

type Step = [
  string[],
  (cwd: string) => { code?: number; stdout?: string } | Promise<{ code?: number; stdout?: string }>,
];

/** A Run that expects these commands in order and records each call's cwd and env. */
function script(steps: Step[]) {
  const seen: { cmd: string[]; cwd: string; env?: Record<string, string>; inherit?: boolean }[] =
    [];
  const queue = [...steps];
  const run: Run = async (cmd, cwd, env, inherit) => {
    seen.push({ cmd, cwd, env, inherit });
    const step = queue.shift();
    if (!step) throw new Error(`unexpected ${cmd.join(" ")}`);
    expect(cmd).toEqual(step[0]);
    const r = await step[1](cwd);
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: "" };
  };
  return { run, seen };
}

const missing =
  (bin: string): Run =>
  async () => {
    throw new Error(`Executable not found in $PATH: "${bin}"`);
  };

test("compareToTag finds missing and changed files", async () => {
  const { f, ctx } = await published();
  const dir = join(await makeTempDir("cmp"), "p");
  await extractPlugin(f, dir);
  expect(await compareToTag(ctx.git, "v0.10.0", "plugins/pmanager", dir)).toEqual([]);
  writeFileSync(join(dir, "skills/pmanager/SKILL.md"), "changed\n");
  const manifest = join(dir, ".codex-plugin/plugin.json");
  await Bun.$`rm ${manifest}`;
  expect(await compareToTag(ctx.git, "v0.10.0", "plugins/pmanager", dir)).toEqual([
    "missing .codex-plugin/plugin.json",
    "differs skills/pmanager/SKILL.md",
  ]);
});

test("githubRoute checks the tag's commit and the release", async () => {
  const { s, gh, ctx } = await published();
  const tmp = await makeTempDir("v");
  expect(await githubRoute(ctx, s, tmp)).toEqual({
    route: "github",
    ok: true,
    detail: "tag and release match",
  });
  (gh.releases[0] as { body: string }).body = "other";
  const r = await githubRoute(ctx, s, tmp);
  expect(r.ok).toBe(false);
  expect(r.detail).toContain("release body differs from the notes");
});

test("claudeRoute installs the tag in an isolated config and compares files", async () => {
  const { f, s, ctx } = await published();
  const tmp = await makeTempDir("v");
  const installPath = join(tmp, "installed");
  await extractPlugin(f, installPath);
  const list = JSON.stringify([
    { id: "pmanager@pmanager", enabled: true, version: "0.10.0", installPath },
  ]);
  const { run, seen } = script([
    [
      ["claude", "plugin", "marketplace", "add", "acme/demo@v0.10.0", "--json"],
      () => ({ stdout: '{"outcome":"ok"}' }),
    ],
    [["claude", "plugin", "install", "pmanager@pmanager"], () => ({})],
    [["claude", "plugin", "list", "--json"], () => ({ stdout: list })],
  ]);
  expect(await claudeRoute({ ...ctx, run }, s, tmp)).toMatchObject({
    route: "claude-code",
    ok: true,
  });
  for (const call of seen) {
    expect(call.inherit).toBe(false);
    expect(call.env?.HOME).toBe(join(tmp, "home"));
    expect(call.env?.CLAUDE_CONFIG_DIR).toBe(join(tmp, "claude"));
    expect(Object.keys(call.env ?? {}).some((k) => k.startsWith("ANTHROPIC"))).toBe(false);
  }
  writeFileSync(join(installPath, "skills/pmanager/SKILL.md"), "changed\n");
  const again = script([
    [
      ["claude", "plugin", "marketplace", "add", "acme/demo@v0.10.0", "--json"],
      () => ({ stdout: "{}" }),
    ],
    [["claude", "plugin", "install", "pmanager@pmanager"], () => ({})],
    [["claude", "plugin", "list", "--json"], () => ({ stdout: list })],
  ]);
  const bad = await claudeRoute({ ...ctx, run: again.run }, s, tmp);
  expect(bad.ok).toBe(false);
  expect(bad.detail).toContain("differs skills/pmanager/SKILL.md");
});

test("codexRoute installs at the tag and checks the cached copy", async () => {
  const { f, s, ctx } = await published();
  const tmp = await makeTempDir("v");
  await extractPlugin(f, join(tmp, "codex", "plugins", "cache", "pmanager", "pmanager", "0.10.0"));
  const steps = (listed: string): Step[] => [
    [
      ["codex", "plugin", "marketplace", "add", "https://github.com/acme/demo", "--ref", "v0.10.0"],
      () => ({}),
    ],
    [["codex", "plugin", "add", "pmanager@pmanager"], () => ({})],
    [
      ["codex", "plugin", "list", "-m", "pmanager"],
      () => ({ stdout: `pmanager@pmanager  installed, enabled  ${listed}\n` }),
    ],
  ];
  const good = script(steps("0.10.0"));
  expect(await codexRoute({ ...ctx, run: good.run }, s, tmp)).toMatchObject({
    route: "codex",
    ok: true,
  });
  expect(good.seen[0]?.env?.CODEX_HOME).toBe(join(tmp, "codex"));
  const old = script(steps("0.9.0"));
  expect((await codexRoute({ ...ctx, run: old.run }, s, tmp)).ok).toBe(false);
});

test("gskillRoute pins the version and checks the lock's commit", async () => {
  const { s, ctx } = await published();
  const lock = (commit: string) => (cwd: string) => {
    writeFileSync(
      join(cwd, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          pmanager: {
            source: "github.com/acme/demo",
            skillPath: "plugins/pmanager/skills/pmanager",
            gskill: { ref: "v0.10.0", commit, version: "0.10.0" },
          },
        },
      }),
    );
    return {};
  };
  const cmd = [
    "gskill",
    "add",
    "github.com/acme/demo",
    "--skill",
    "pmanager",
    "--version",
    "0.10.0",
    "--agent",
    "claude",
  ];
  for (const [commit, ok] of [
    [s.commit, true],
    ["0".repeat(40), false],
  ] as const) {
    const tmp = await makeTempDir("v");
    const { run, seen } = script([
      [["git", "init", "-q"], () => ({})],
      [cmd, lock(commit)],
    ]);
    const r = await gskillRoute({ ...ctx, run }, s, tmp);
    expect(r.ok).toBe(ok);
    expect(seen[1]?.cwd).toBe(join(tmp, "project"));
  }
});

test("a missing CLI makes its route fail as unavailable", async () => {
  const { s, ctx } = await published();
  const tmp = await makeTempDir("v");
  expect(await claudeRoute({ ...ctx, run: missing("claude") }, s, tmp)).toEqual({
    route: "claude-code",
    ok: false,
    detail: "unavailable: claude not found",
  });
});

test("verify reports a published release with a failed route, and a rerun can pass", async () => {
  const { f, ctx } = await published();
  const fail: Route = async () => ({ route: "codex", ok: false, detail: "wrong version" });
  const pass: Route = async () => ({ route: "github", ok: true, detail: "ok" });
  const r = await cmdVerify({ ...ctx, routes: [pass, fail] });
  expect(r.code).toBe(1);
  expect(r.phase).toBe("published-verify-failed");
  expect(r.message).toBe("v0.10.0 is published but verification failed: codex");
  expect(r.blockers).toEqual(["codex: wrong version"]);
  expect((await readState(f.cfg))?.phase).toBe("published-verify-failed");
  const again = await cmdVerify({ ...ctx, routes: [pass] });
  expect(again).toMatchObject({ code: 0, phase: "published" });
});

test("verify refuses before anything is published", async () => {
  const { f, s, ctx } = await published();
  await writeState(f.cfg, { ...s, phase: "checked" });
  expect((await cmdVerify(ctx)).code).toBe(1);
});
