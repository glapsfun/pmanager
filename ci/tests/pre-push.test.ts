import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { main } from "../gate";
import { type CheckName, STAGES } from "../stages";

const ZEROS = "0".repeat(40);

let errors: string[];
let error: ReturnType<typeof spyOn>;
let ran: CheckName[][];

beforeEach(() => {
  errors = [];
  ran = [];
  error = spyOn(console, "error").mockImplementation((...a) => {
    const line = a.join(" ");
    if (!line.includes("differs from .bun-version")) errors.push(line);
  });
});

afterEach(() => error.mockRestore());

const runChecks = async (names: CheckName[]) => {
  ran.push(names);
  return 0;
};

async function repo(): Promise<{ root: string; first: string; head: string; short: string }> {
  const root = await makeTempDir("pre-push");
  await initGitRepo(root);
  const first = (await gitOk(["rev-parse", "HEAD"], root)).trim();
  await gitOk(["commit", "-q", "--allow-empty", "-m", "second"], root);
  const head = (await gitOk(["rev-parse", "HEAD"], root)).trim();
  const short = (await gitOk(["rev-parse", "--short", "HEAD"], root)).trim();
  return { root, first, head, short };
}

test("a dirty tree fails before any check runs", async () => {
  const { root } = await repo();
  await writeFile(join(root, "untracked.txt"), "x\n");
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => "",
    runChecks,
  });
  expect(code).toBe(1);
  expect(ran).toEqual([]);
  const out = errors.join("\n");
  expect(out).toContain("?? untracked.txt");
  expect(out).toContain("commit, stash or remove");
});

test("a pushed ref that is not HEAD warns and the checks still run", async () => {
  const { root, first, head, short } = await repo();
  await gitOk(["-c", "tag.gpgSign=false", "tag", "-a", "v1", "-m", "v1"], root);
  const tag = (await gitOk(["rev-parse", "v1"], root)).trim();
  const stdin = [
    `refs/heads/old ${first} refs/heads/old ${ZEROS}`,
    `refs/heads/main ${head} refs/heads/main ${ZEROS}`,
    `refs/tags/v1 ${tag} refs/tags/v1 ${ZEROS}`,
    "",
  ].join("\n");
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => stdin,
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([STAGES["pre-push"]]);
  expect(errors).toEqual([`pre-push checked HEAD ${short}, not refs/heads/old; CI will check it`]);
});

test("a branch deletion line is skipped", async () => {
  const { root, first } = await repo();
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => `(delete) ${ZEROS} refs/heads/gone ${first}\n`,
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([STAGES["pre-push"]]);
  expect(errors).toEqual([]);
});

test("run by hand, pre-push never reads stdin", async () => {
  const { root } = await repo();
  const code = await main(["pre-push"], {
    root,
    stdin: () => {
      throw new Error("stdin read");
    },
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([STAGES["pre-push"]]);
});
