import { expect, test } from "bun:test";
import {
  type Change,
  draftNotes,
  notesProblems,
  parseSubject,
  previousRelease,
  proposeVersion,
  shippedChanges,
} from "../scripts/changes";
import { gitClient } from "../scripts/git";
import { formatVersion } from "../scripts/semver";
import { commitAndPush, commitOnBranch, makeFixture, mergePrIntoMain } from "./fixture";

const SKILL = "plugins/pmanager/skills/pmanager/SKILL.md";
const v0100 = { major: 0, minor: 10, patch: 0 };

const change = (type: string, breaking = false, pr: number | null = 7): Change => ({
  sha: "abcdef1234567890",
  subject: `${type}(pm): thing ${type}`,
  type,
  breaking,
  pr,
});

test("parseSubject reads type and breaking marks", () => {
  expect(parseSubject("feat(pm): x", "")).toEqual({ type: "feat", breaking: false });
  expect(parseSubject("fix!: x", "")).toEqual({ type: "fix", breaking: true });
  expect(parseSubject("refactor: x", "BREAKING CHANGE: y")).toEqual({
    type: "refactor",
    breaking: true,
  });
  expect(parseSubject("pm: old style", "")).toEqual({ type: "other", breaking: false });
});

test("previousRelease finds the highest tag merged into origin main", async () => {
  const f = await makeFixture();
  expect((await previousRelease(gitClient(f.root), f.cfg))?.tag).toBe("v0.10.0");
  const bare = await makeFixture({ tagged: false });
  expect(await previousRelease(gitClient(bare.root), bare.cfg)).toBeNull();
});

test("shippedChanges keeps commits on shipped paths, oldest first, with their PR", async () => {
  const f = await makeFixture();
  await commitAndPush(f, { "README.md": "docs\n" }, "docs: readme only");
  await commitAndPush(f, { "ci/x.ts": "x\n" }, "ci: tooling only");
  const direct = await commitAndPush(f, { [SKILL]: "a\n" }, "fix(pm): direct fix");
  await commitAndPush(f, { ".claude-plugin/marketplace.json": "{}\n" }, "feat(plugin): market");
  const viaPr = await commitOnBranch(f, "feat/x", { [SKILL]: "b\n" }, "feat(pm): from a PR");
  await mergePrIntoMain(f, "feat/x", 7);
  await commitAndPush(f, { [SKILL]: "c\n" }, "chore(release): v0.10.1");
  const got = await shippedChanges(gitClient(f.root), f.cfg, "v0.10.0");
  expect(got.map((c) => c.subject)).toEqual([
    "fix(pm): direct fix",
    "feat(plugin): market",
    "feat(pm): from a PR",
  ]);
  expect(got.find((c) => c.sha === direct)?.pr).toBeNull();
  expect(got.find((c) => c.sha === viaPr)?.pr).toBe(7);
});

test("proposeVersion follows the commit types", () => {
  expect(formatVersion(proposeVersion(v0100, [change("fix")]))).toBe("0.10.1");
  expect(formatVersion(proposeVersion(v0100, [change("fix"), change("feat")]))).toBe("0.11.0");
  expect(formatVersion(proposeVersion(v0100, [change("fix", true)]))).toBe("0.11.0");
});

test("draftNotes groups by kind, cites PR or commit, and asks for migration on breaking", () => {
  const notes = draftNotes([
    change("docs", false, null),
    change("fix"),
    change("feat"),
    change("refactor", true),
  ]);
  expect(notes).toBe(
    [
      "## Breaking",
      "",
      "- thing refactor (#7)",
      "",
      "## Added",
      "",
      "- thing feat (#7)",
      "",
      "## Fixed",
      "",
      "- thing fix (#7)",
      "",
      "## Other",
      "",
      "- thing docs (abcdef1)",
      "",
      "## Migration",
      "",
      "- TODO: what users must do",
      "",
    ].join("\n"),
  );
  expect(draftNotes([change("fix")])).toBe("## Fixed\n\n- thing fix (#7)\n");
});

test("notesProblems flags empty notes, TODOs and uncited bullets", () => {
  expect(notesProblems("  \n")).toEqual(["notes are empty"]);
  expect(notesProblems(draftNotes([change("fix"), change("feat")]))).toEqual([]);
  expect(notesProblems("## Fixed\n\n- a fix\n")).toEqual([
    "notes line has no PR or commit citation: - a fix",
  ]);
  expect(notesProblems(draftNotes([change("fix", true)]))).toEqual([
    "notes still contain a TODO: - TODO: what users must do",
  ]);
  expect(notesProblems("## Fixed\n\n- x (#1)\n\n## Migration\n\n- Rerun pm check\n")).toEqual([]);
});
