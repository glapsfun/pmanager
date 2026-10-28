import { expect, test } from "bun:test";
import { join } from "node:path";
import { clearGitEnv, GIT_LOCAL_ENV } from "../../plugins/pmanager/skills/pmanager/tests/git-env";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { type Ctx, main } from "../gate";
import { REPO_ROOT } from "../packages";
import { capture } from "../proc";

const SETUP = join(REPO_ROOT, "plugins", "pmanager", "skills", "pmanager", "tests", "setup.ts");

test("the cleared list covers every var git calls repo-local", async () => {
  const listed = (await gitOk(["rev-parse", "--local-env-vars"], REPO_ROOT)).split("\n");
  for (const name of listed.filter(Boolean)) expect(GIT_LOCAL_ENV).toContain(name);
});

test("clearGitEnv removes the repo-local vars and returns them", () => {
  const env: NodeJS.ProcessEnv = { GIT_DIR: "/r/.git", GIT_INDEX_FILE: "/r/i", HOME: "/h" };
  expect(clearGitEnv(env)).toEqual({ GIT_DIR: "/r/.git", GIT_INDEX_FILE: "/r/i" });
  expect(env).toEqual({ HOME: "/h" });
});

test("main clears the hook's git env and hands it to the checks", async () => {
  process.env.GIT_DIR = "/hook/.git";
  process.env.GIT_INDEX_FILE = "/hook/.git/index.lock";
  let seen: Ctx | undefined;
  try {
    const code = await main(["pre-commit"], {
      runChecks: async (_names, ctx) => {
        seen = ctx;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(process.env.GIT_DIR).toBeUndefined();
    expect(process.env.GIT_INDEX_FILE).toBeUndefined();
    expect(seen?.gitEnv).toEqual({
      GIT_DIR: "/hook/.git",
      GIT_INDEX_FILE: "/hook/.git/index.lock",
    });
  } finally {
    delete process.env.GIT_DIR;
    delete process.env.GIT_INDEX_FILE;
  }
});

test("a test run under the shared preload leaves the hook's repository alone", async () => {
  const dir = await makeTempDir("git-env");
  const hookRepo = join(dir, "hook-repo");
  await writeTree(join(dir, "spec"), {
    "x.test.ts": `import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("git in its own temp dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "inner-"));
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env } }).exitCode;
  expect(git("init", "-q")).toBe(0);
  const id = ["-c", "user.name=x", "-c", "user.email=x@example.com", "-c", "commit.gpgsign=false"];
  expect(git(...id, "commit", "-q", "--allow-empty", "-m", "x")).toBe(0);
  expect(git("config", "user.name", "x")).toBe(0);
});
`,
  });
  await writeTree(hookRepo, { "a.txt": "a\n" });
  await initGitRepo(hookRepo);
  const head = await gitOk(["rev-parse", "HEAD"], hookRepo);

  const run = await capture(["bun", "test", "--preload", SETUP, "./x.test.ts"], join(dir, "spec"), {
    GIT_DIR: join(hookRepo, ".git"),
    GIT_WORK_TREE: hookRepo,
  });
  expect(run.code).toBe(0);
  expect(await gitOk(["rev-parse", "HEAD"], hookRepo)).toBe(head);
  expect((await gitOk(["config", "user.name"], hookRepo)).trim()).toBe("test");
}, 30000);
