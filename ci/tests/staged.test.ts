import { expect, spyOn, test } from "bun:test";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { lintStagedCheck, stagedByPackage } from "../checks/staged";
import { PACKAGES, REPO_ROOT } from "../packages";
import { capture } from "../proc";

test("groups staged paths by package and drops the rest", () => {
  const map = stagedByPackage(
    [
      "bench/runner.ts",
      "README.md",
      "ci/gate.ts",
      "plugins/pmanager/skills/pmanager/scripts/pm.ts",
      ".github/workflows/gate.yml",
    ],
    PACKAGES,
  );
  expect([...map.keys()].sort()).toEqual(["bench", "ci", "tool"]);
  expect(map.get("bench")).toEqual(["runner.ts"]);
  expect(map.get("ci")).toEqual(["gate.ts"]);
  expect(map.get("tool")).toEqual(["scripts/pm.ts"]);
});

test("lint-staged spawns nothing when no staged path is in a package", async () => {
  const spawned: string[][] = [];
  const ok = await lintStagedCheck(
    { root: REPO_ROOT, ci: false, args: [] },
    {
      capture: async () => ({ code: 0, stdout: "README.md\0", stderr: "" }),
      sh: async (cmd) => {
        spawned.push(cmd);
        return 0;
      },
    },
  );
  expect(ok).toBe(true);
  expect(spawned).toEqual([]);
});

test("lint-staged runs biome per package with package-relative files", async () => {
  const spawned: { cmd: string[]; cwd: string }[] = [];
  const ok = await lintStagedCheck(
    { root: REPO_ROOT, ci: false, args: [] },
    {
      capture: async () => ({ code: 0, stdout: "ci/gate.ts\0bench/a.ts\0", stderr: "" }),
      sh: async (cmd, cwd) => {
        spawned.push({ cmd, cwd });
        return cmd.includes("a.ts") ? 1 : 0;
      },
    },
  );
  expect(ok).toBe(false);
  expect(spawned.map((s) => s.cmd.at(-1))).toEqual(["gate.ts", "a.ts"]);
});

test("lint-staged reads the commit's temporary index from the hook's git env", async () => {
  const root = await makeTempDir("staged-index");
  await initGitRepo(root);
  await writeTree(root, { "ci/a.ts": "export {};\n", "ci/biome.json": "{}\n" });
  const index = join(root, ".git", "next-index.lock");
  const add = await capture(["git", "add", "ci/a.ts", "ci/biome.json"], root, {
    GIT_INDEX_FILE: index,
  });
  expect(add.code).toBe(0);
  const linted = async (gitEnv?: Record<string, string>) => {
    const files: string[] = [];
    const ok = await lintStagedCheck(
      { root, ci: false, args: [], gitEnv },
      {
        capture,
        sh: async (cmd) => {
          files.push(...cmd.slice(4));
          return 0;
        },
      },
    );
    expect(ok).toBe(true);
    return files;
  };
  expect(await linted()).toEqual([]);
  expect(await linted({ GIT_INDEX_FILE: index })).toEqual(["a.ts", "biome.json"]);
});

test("lint-staged prints why git diff failed", async () => {
  const lines: string[] = [];
  const error = spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));
  try {
    const ok = await lintStagedCheck(
      { root: REPO_ROOT, ci: false, args: [] },
      {
        capture: async () => ({ code: 128, stdout: "", stderr: "fatal: index file open failed\n" }),
        sh: async () => 0,
      },
    );
    expect(ok).toBe(false);
    expect(lines).toEqual(["lint-staged: git diff --cached failed: fatal: index file open failed"]);
  } finally {
    error.mockRestore();
  }
});

test("lint-staged checks the staged content of a partly staged file, whatever its name", async () => {
  const root = await makeTempDir("staged-snapshot");
  await initGitRepo(root);
  const file = "ci/checks/café.ts";
  await writeTree(root, {
    "ci/biome.json": await readFile(join(REPO_ROOT, "ci", "biome.json"), "utf8"),
    [file]: "export const x=1\n",
  });
  await symlink(join(REPO_ROOT, "ci", "node_modules"), join(root, "ci", "node_modules"), "dir");
  await gitOk(["add", "ci/biome.json", file], root);
  const quiet = {
    capture,
    sh: async (cmd: string[], cwd: string) => (await capture(cmd, cwd)).code,
  };
  const ctx = { root, ci: false, args: [] };
  await writeFile(join(root, file), "export const x = 1;\n");
  expect(await lintStagedCheck(ctx, quiet)).toBe(false);
  await gitOk(["add", file], root);
  await writeFile(join(root, file), "export const x=1\n");
  expect(await lintStagedCheck(ctx, quiet)).toBe(true);
});
