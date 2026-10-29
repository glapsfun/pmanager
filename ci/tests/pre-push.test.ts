import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { main } from "../gate";
import { type CheckName, STAGES } from "../stages";

const ZEROS = "0".repeat(40);
const SKIPPED =
  "pre-push: the pushed commits change nothing outside docs/pm, so there is nothing to check";

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

async function commit(
  root: string,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  await writeTree(root, files);
  await gitOk(["add", "--", ...Object.keys(files)], root);
  await gitOk(["commit", "-q", "-m", message], root);
  return (await gitOk(["rev-parse", "HEAD"], root)).trim();
}

const line = (sha: string, ref = "refs/heads/main") => `${ref} ${sha} ${ref} ${ZEROS}\n`;

/** A repo whose main is already on a bare origin, so only later commits count as pushed. */
async function published(): Promise<string> {
  const { root } = await repo();
  const bare = await makeTempDir("pre-push-origin");
  await gitOk(["init", "-q", "--bare", "-b", "main"], bare);
  await gitOk(["remote", "add", "origin", bare], root);
  await gitOk(["push", "-q", "origin", "main"], root);
  return root;
}

async function repo(): Promise<{ root: string; first: string; head: string; short: string }> {
  const root = await makeTempDir("pre-push");
  await initGitRepo(root);
  const first = (await gitOk(["rev-parse", "HEAD"], root)).trim();
  await commit(root, { "ci/x.ts": "export {};\n" }, "second");
  const head = (await gitOk(["rev-parse", "HEAD"], root)).trim();
  const short = (await gitOk(["rev-parse", "--short", "HEAD"], root)).trim();
  return { root, first, head, short };
}

test("a dirty tree fails before any check runs", async () => {
  const { root, head } = await repo();
  await writeFile(join(root, "untracked.txt"), "x\n");
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => line(head),
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
  const { root, first, head } = await repo();
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => `(delete) ${ZEROS} refs/heads/gone ${first}\n${line(head)}`,
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([STAGES["pre-push"]]);
  expect(errors).toEqual([]);
});

test("a push of pm state only skips the checks, even with uncommitted work", async () => {
  const root = await published();
  const pm = await commit(root, { "docs/pm/x/epic.md": "x\n" }, "docs(pm): reserve x");
  await writeFile(join(root, "ci", "x.ts"), "export const wip = 1;\n");
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => line(pm, "refs/heads/pm/x"),
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([]);
  expect(errors).toEqual([SKIPPED]);
});

test("a deletion-only push skips the checks", async () => {
  const root = await published();
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => `(delete) ${ZEROS} refs/heads/gone ${"1".repeat(40)}\n`,
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([]);
  expect(errors).toEqual([SKIPPED]);
});

test("pushed commits that touch code outside docs/pm run the checks", async () => {
  const root = await published();
  await commit(root, { "docs/pm/x/epic.md": "x\n" }, "docs(pm): reserve x");
  const head = await commit(root, { "bench/a.ts": "export {};\n" }, "feat(bench): a");
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => line(head),
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([STAGES["pre-push"]]);
  expect(errors).toEqual([]);
});

test("a merge among the pushed commits runs the checks", async () => {
  const root = await published();
  await gitOk(["checkout", "-q", "-b", "side"], root);
  await commit(root, { "docs/pm/a/epic.md": "a\n" }, "docs(pm): a");
  await gitOk(["checkout", "-q", "main"], root);
  await commit(root, { "docs/pm/b/epic.md": "b\n" }, "docs(pm): b");
  await gitOk(["merge", "-q", "--no-edit", "side"], root);
  const head = (await gitOk(["rev-parse", "HEAD"], root)).trim();
  const code = await main(["pre-push", "--hook", "origin", "url"], {
    root,
    stdin: async () => line(head),
    runChecks,
  });
  expect(code).toBe(0);
  expect(ran).toEqual([STAGES["pre-push"]]);
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
