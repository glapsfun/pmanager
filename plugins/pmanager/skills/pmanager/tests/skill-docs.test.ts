import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string): string => s.replace(/\s+/g, " ");
function between(s: string, start: string, end: string): string {
  const a = s.indexOf(start);
  const b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`no section ${start} .. ${end}`);
  return s.slice(a, b);
}

const SKILL = read("SKILL.md");
const preflight = () => flat(between(SKILL, "**Preflight.**", "**Route the request**"));
const phase1 = () => flat(between(SKILL, "### Phase 1", "### Phase 2"));
const phase2 = () => flat(between(SKILL, "### Phase 2", "### Phase 3"));
const phase4 = () => flat(between(SKILL, "### Phase 4", "### Phase 5"));
const phase5 = () => flat(between(SKILL, "### Phase 5", "### Phase 6"));
const phase6 = () => between(SKILL, "### Phase 6", "## Degraded situations");

function oneSentence(text: string, parts: string[], must: string): boolean {
  return text.split(/(?<=\.)\s/).some((s) => s.includes(must) && parts.every((p) => s.includes(p)));
}

test("every reference SKILL.md names exists", () => {
  const names = new Set(SKILL.match(/references\/[\w.-]+\.md/g) ?? []);
  expect(names.size).toBeGreaterThan(0);
  for (const n of names) expect(existsSync(join(ROOT, n))).toBe(true);
});

test("the new-epic path never points at commands.md or memory.md", () => {
  for (const s of [
    between(SKILL, "**Preflight.**", "**Route the request**"),
    between(SKILL, "### Phase 1", "## Degraded situations"),
  ]) {
    expect(s).not.toContain("commands.md");
    expect(s).not.toContain("memory.md");
  }
});

test("new-epic commands are inline, each in its own phase", () => {
  expect(phase1()).toContain("pm claim <slug> --draft --title");
  expect(phase2()).toContain("pm research <keywords>");
  expect(phase4()).toContain("pm claim <slug> --harness <yours>");
  const p6 = flat(phase6());
  for (const p of [
    "pm record <slug> --harness <yours>",
    "--kind spec",
    "--from - <<'PM_BUNDLE'",
    "<!-- pm:file <slug>/plan.md -->",
  ]) {
    expect(p6).toContain(p);
  }
});

test("Phase 4 says a draft reservation already holds the claim", () => {
  expect(phase4()).toContain(
    "With a draft reservation you already hold the claim; do not run `pm claim` again.",
  );
});

test("Phase 6 carries the not-claimed recovery and the exit-0 skips", () => {
  const s = flat(phase6());
  expect(s).toContain("Exit 1 `is not claimed; run pm claim <slug> first` (origin reachable");
  expect(s).toContain("run `pm claim <slug> --harness <yours>`, then rerun the same `pm record`");
  expect(s).toContain("`--session <id>` from the claim's output");
  expect(s).toContain(
    "`not committed:` with exit 0 (not a git repository, staged changes outside `docs/pm`, nothing to commit)",
  );
  expect(s).toContain("report it in the summary and run no git by hand");
});

test("unreachable origin is treated like no remote", () => {
  expect(preflight()).toContain("`none` or `unreachable` means no remote for the whole run");
  expect(flat(phase6())).toContain("`origin unreachable`");
});

test("preflight checks Bun and reads status in one command", () => {
  expect(preflight()).toContain(
    "`bun --version && bun run <skill-dir>/scripts/pm.ts status --harness <yours>`",
  );
});

test("a non-interactive run reads the Phase 5 batch with the Phase 2 batch", () => {
  expect(
    oneSentence(
      phase2(),
      ["plan.template.md", "task.template.md", "prioritization.md", "memo.template.md"],
      "non-interactive run",
    ),
  ).toBe(true);
});

test("Phase 6 records with one command", () => {
  const s = phase6();
  expect(s).toContain("pm record");
  expect(s).not.toContain("git commit");
  expect(s).not.toContain("git -C");
});

test("research comes first", () => {
  expect(phase2()).toContain("no `ls`, `find`, `git log` or `git show` before it");
});

test("references are read in two batches", () => {
  expect(
    oneSentence(phase2(), ["research.md", "elicitation.md", "epic.template.md"], "one step"),
  ).toBe(true);
  expect(
    oneSentence(
      phase5(),
      ["plan.template.md", "task.template.md", "prioritization.md"],
      "one step",
    ),
  ).toBe(true);
});

test("preflight reads the remote from pm status", () => {
  const s = preflight();
  expect(s).toContain("remote:");
  expect(s).toContain("never run `git remote`");
});

test("ground rule 2 names the no-remote exception", () => {
  const s = flat(between(SKILL, "## Ground rules", "## The spec ledger"));
  expect(s).toContain("no origin remote");
  expect(s).toContain("`pm record` commits on the branch the checkout has");
});

test("commands.md has a record row", () => {
  expect(read("references/commands.md")).toMatch(/^\| `record <slug>/m);
});

test("memory.md Write-back names pm record", () => {
  const s = between(read("references/memory.md"), "## Write-back", "## Edge cases");
  expect(s).toContain("`pm record`");
});

test("update routing names a failed attempt", () => {
  expect(flat(SKILL)).toContain('"T03 attempt failed"');
});

test("tracking.md carries both History forms and the date meaning", () => {
  const t = flat(read("references/tracking.md"));
  expect(t).toContain("- YYYY-MM-DD status <from> -> <to>");
  expect(t).toContain("; fixed by <what>");
  expect(t).toContain("- YYYY-MM-DD attempt failed: tried <what>; got <result>; evidence <path>");
  expect(t).toContain("the day the planning session recorded the report");
  expect(t).toContain("never paste log output");
});

test("the task template points at History but its skeleton has none", () => {
  const raw = read("references/task.template.md");
  const block = /```markdown\n([\s\S]*?)```/.exec(raw)?.[1] ?? "";
  expect(block).not.toContain("## History");
  expect(flat(raw)).toContain("`## History`");
  expect(flat(raw)).toContain("tracking.md");
});

test("done claims pass only the done report's evidence to pm verify", () => {
  const t = flat(read("references/tracking.md"));
  expect(t).toContain("never a failed attempt's evidence path");
});

test("tracking.md shows a multi-event History in event order", () => {
  const raw = read("references/tracking.md");
  expect(raw).toContain(
    [
      "## History",
      "",
      "- 2026-11-03 status todo -> in-progress",
      "- 2026-11-03 attempt failed: tried <what>; got <result>; evidence <path>",
      "- 2026-11-04 status in-progress -> done; fixed by <what>",
    ].join("\n"),
  );
  const t = flat(raw);
  expect(t).toContain("one line per event, in the order the events happened");
  expect(t).toContain("`status todo -> in-progress` line comes before its first attempt line");
});

test("several reports in one request render and check once", () => {
  const t = flat(read("references/tracking.md"));
  expect(t).toContain("apply all their edits first, then render and check once");
});

test("each History event stays on one line", () => {
  const t = flat(read("references/tracking.md"));
  expect(t).toContain("Each event is one line, never wrapped");
});
