import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { offlineEnv } from "../offline";

const onPath = (tool: string) => Bun.which(tool) !== null;

/** Runs a fetch with the offline env; a blocked fetch exits non-zero, and fast. */
async function blocked(cmd: string[], setup?: (dir: string) => Promise<void>) {
  const dir = await makeTempDir("bench-offline");
  const work = join(dir, "work");
  await mkdir(work);
  await setup?.(work);
  const started = Date.now();
  const p = Bun.spawn(cmd, {
    cwd: work,
    env: { ...process.env, ...offlineEnv(join(dir, "offline")) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await p.exited;
  return { code, ms: Date.now() - started };
}

test("go writes its module cache writable, so cleanup can remove what a run fetched", () => {
  expect(offlineEnv("/tmp/x").GOFLAGS?.split(" ")).toContain("-modcacherw");
});

describe("offlineEnv blocks each package manager", () => {
  test.skipIf(!onPath("go"))(
    "go cannot download a module",
    async () => {
      const r = await blocked(["go", "mod", "download", "golang.org/x/text@v0.3.0"], (d) =>
        writeFile(join(d, "go.mod"), "module example.com/probe\n\ngo 1.22\n"),
      );
      expect(r.code).not.toBe(0);
      expect(r.ms).toBeLessThan(15_000);
    },
    20_000,
  );

  test.skipIf(!onPath("npm"))(
    "npm cannot reach a registry",
    async () => {
      const r = await blocked(["npm", "view", "left-pad", "version"]);
      expect(r.code).not.toBe(0);
      expect(r.ms).toBeLessThan(15_000);
    },
    20_000,
  );

  test.skipIf(!onPath("bun"))(
    "bun cannot add a package",
    async () => {
      const r = await blocked(["bun", "add", "left-pad"], (d) =>
        writeFile(join(d, "package.json"), '{ "name": "probe", "version": "1.0.0" }\n'),
      );
      expect(r.code).not.toBe(0);
      expect(r.ms).toBeLessThan(15_000);
    },
    20_000,
  );

  test.skipIf(!onPath("uv"))(
    "uv cannot lock a project",
    async () => {
      const r = await blocked(["uv", "lock"], (d) =>
        writeFile(
          join(d, "pyproject.toml"),
          '[project]\nname = "probe"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = ["requests"]\n',
        ),
      );
      expect(r.code).not.toBe(0);
      expect(r.ms).toBeLessThan(15_000);
    },
    20_000,
  );
});
