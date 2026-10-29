import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exists,
  gitOk,
  initGitRepo,
  makeTempDir,
  remoteWithClones,
  unclaimedSeed,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { epicBundle, pmProcess } from "./pm";

const SLUG = "e2e-epic";

test("a user's day: draft, record, verify, render, check, status, release", async () => {
  const { bare, a } = await remoteWithClones(await unclaimedSeed());
  const target = await makeTempDir("e2e-target");
  await initGitRepo(target);
  await writeTree(target, { "app/app.py": "print('hi')\n" });
  await gitOk(["add", "-A"], target);
  await gitOk(["commit", "-q", "-m", "touch app"], target);
  const pm = (...args: string[]) => pmProcess(a, args);

  const claim = await pm("claim", SLUG, "--draft", "--title", "E2E epic", "--type", "feature");
  expect(claim.code).toBe(0);
  expect(claim.stdout).toContain("e2e-epic reserved as draft by e2e");
  expect((await gitOk(["ls-remote", "origin", `pm/${SLUG}`], a)).trim()).not.toBe("");
  const sid = /session: ([0-9a-f]{6})/.exec(claim.stdout)?.[1] ?? "missing";
  const worktree = /worktree: (.+)/.exec(claim.stdout)?.[1] ?? "";
  expect(worktree).not.toBe("");

  const bundle = await epicBundle(SLUG, ["epic.md", "plan.md", "tasks/T01-benchmark-orders.md"], {
    harness: "e2e",
    id: sid,
  });
  const record = await pmProcess(
    a,
    [
      "record",
      SLUG,
      "--harness",
      "e2e",
      "--session",
      sid,
      "--kind",
      "spec",
      "-m",
      `spec ${SLUG}`,
      "--from",
      "-",
    ],
    { stdin: bundle },
  );
  expect(record.code).toBe(0);
  expect(record.stdout).toContain(", pushed");
  expect((await gitOk(["log", "-1", "--format=%s", `pm/${SLUG}`], bare)).trim()).toBe(
    `docs(pm): spec ${SLUG}`,
  );

  const onRemote = (path: string) => gitOk(["show", `pm/${SLUG}:docs/pm/${SLUG}/${path}`], bare);
  expect(await onRemote("epic.md")).toContain(`id: ${SLUG}`);
  expect(await onRemote("plan.md")).toContain(SLUG);
  expect(await onRemote("tasks/T01-benchmark-orders.md")).toContain("T01");

  const verify = await pm("verify", SLUG, "T01", "--repo", target);
  expect(verify.code).toBe(0);
  expect(verify.stdout.split("\n")[0]).toMatch(/^verify: e2e-epic T01 · /);

  const render = await pm("render", "--epic", SLUG, "--session", sid);
  expect(render.code).toBe(0);
  expect((await pm("check", "--epic", SLUG)).code).toBe(0);

  const row = new RegExp(
    `\\| \\[${SLUG}\\]\\(${SLUG}/epic\\.md\\) \\|[^\\n]*\\| e2e · 2026-09-28 \\|`,
  );
  expect(await readFile(join(worktree, "docs/pm/INDEX.md"), "utf8")).toMatch(row);
  expect(await gitOk(["show", `pm/${SLUG}:docs/pm/INDEX.md`], bare)).toMatch(row);

  const status = await pm("status");
  expect(status.code).toBe(0);
  expect(status.stdout).toContain(SLUG);
  expect(status.stdout).toContain(`session: e2e · 2026-09-28 · ${sid}`);

  const release = await pm("release", SLUG, "--session", sid);
  expect(release.code).toBe(0);
  expect(await exists(worktree)).toBe(false);
  const after = await pm("status");
  expect(after.code).toBe(0);
  expect(after.stdout).not.toMatch(new RegExp(`${SLUG}[^\\n]*\\n\\s*session:`));
});
