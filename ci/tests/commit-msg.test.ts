import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subjectOf, subjectProblem } from "../checks/commit-msg";
import { main } from "../gate";

const SCOPES = ["pm", "skill", "bench", "plugin", "ci", "deps"];

test("subjectOf skips blanks and comments, stops at scissors", () => {
  expect(subjectOf("\n# Please enter\nfix: y\n# c")).toBe("fix: y");
  expect(subjectOf("feat(pm): x\n\nbody")).toBe("feat(pm): x");
  expect(subjectOf("# ------------------------ >8 ------------------------\ndiff")).toBe("");
  expect(subjectOf("\n# c\n# ------------------------ >8 ------------------------\nfix: z")).toBe(
    "",
  );
});

test("accepted subjects", () => {
  for (const s of [
    "feat(pm): add x",
    "fix: y",
    "feat(bench)!: drop z",
    "Merge pull request #20 from glapsfun/feat/x",
    "Merge branch 'main' into feat/x",
    'Revert "feat(pm): add x"',
    "chore(bench): record claude-code run 123",
  ]) {
    expect(subjectProblem(s, SCOPES)).toBeNull();
  }
});

test("autosquash subjects pass only when allowed", () => {
  for (const s of ["fixup! fix: y", "squash! feat(pm): x", "amend! fix: y"]) {
    expect(subjectProblem(s, SCOPES, true)).toBeNull();
    expect(subjectProblem(s, SCOPES)).toContain("squashed before merge");
  }
  expect(subjectProblem("fixup!: y", SCOPES, true)).not.toBeNull();
});

test("rejected subjects name the reason", () => {
  const cases: [string, string][] = [
    ["pm: record x", "unknown type pm"],
    ["feat(web): x", "scope web not allowed"],
    ["feat(pm):x", "type(scope): message"],
    ["feat(pm): ", "empty message"],
    ["Feat(pm): x", "unknown type Feat"],
    ["", "empty subject"],
  ];
  for (const [subject, problem] of cases) {
    expect(subjectProblem(subject, SCOPES)).toContain(problem);
  }
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
  await p.exited;
}

test("commits check lists every bad commit in the range", async () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-"));
  const prev = process.cwd();
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));
  try {
    await git(dir, "init", "-q");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "t");
    await git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    const base = (
      await new Response(
        Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: dir, stdout: "pipe" }).stdout,
      ).text()
    ).trim();
    await git(dir, "commit", "-q", "--allow-empty", "-m", "fix: ok");
    await git(dir, "commit", "-q", "--allow-empty", "-m", "wip");
    await git(dir, "commit", "-q", "--allow-empty", "-m", "fixup! fix: ok");
    process.chdir(dir);
    const code = await main(["commits", `${base}..HEAD`]);
    const out = lines.join("\n");
    expect(code).toBe(1);
    expect(out).toContain("wip");
    expect(out).toContain("fixup! fix: ok: fixup!, squash! and amend! commits must be squashed");
    expect(out).not.toMatch(/^\w+ fix: ok:/m);
  } finally {
    process.chdir(prev);
    log.mockRestore();
    error.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commit-msg check reads the file and fails on a bad subject", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-"));
  const prev = process.cwd();
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    await Bun.write(join(dir, "good"), "fix: y\n");
    await Bun.write(join(dir, "fixup"), "fixup! fix: y\n");
    await Bun.write(join(dir, "bad"), "wip\n");
    process.chdir(dir);
    expect(await main(["commit-msg", "good"])).toBe(0);
    expect(await main(["commit-msg", "fixup"])).toBe(0);
    expect(await main(["commit-msg", "bad"])).toBe(1);
    expect(await main(["commit-msg"])).toBe(1);
  } finally {
    process.chdir(prev);
    log.mockRestore();
    error.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
