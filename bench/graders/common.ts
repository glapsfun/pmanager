import { errorsOf } from "./context";
import type { Check, CheckContext, CheckResult } from "./types";

const NO_REPO = "docs/pm is missing or unreadable";

/** A docs/pm holding nothing but the contract file counts as absent for the doc checks. */
function emptyRepo(ctx: CheckContext): boolean {
  const r = ctx.repo;
  return r === null || (r.epics.length === 0 && r.index === null && r.memo === null);
}

export function pass(evidence: string): CheckResult {
  return { passed: true, evidence };
}

export function fail(evidence: string): CheckResult {
  return { passed: false, evidence };
}

export function skip(evidence: string): CheckResult {
  return { passed: null, evidence };
}

export const runCompleted: Check = {
  id: "run-completed",
  kind: "diagnostic",
  description: "the harness exited 0 within the timeout and produced a final message",
  async run(ctx) {
    const problems: string[] = [];
    if (ctx.run.timedOut) problems.push("timed out");
    else if (ctx.run.exitCode !== 0) problems.push(`exit code ${ctx.run.exitCode}`);
    if (ctx.telemetry.finalMessage === null) problems.push("no final message");
    return problems.length === 0 ? pass("exit 0 with a final message") : fail(problems.join(", "));
  },
};

export const scopedDiff: Check = {
  id: "scoped-diff",
  kind: "outcome",
  description: "every path changed since baseline is under docs/pm/",
  async run(ctx) {
    const outside = ctx.changedPaths.filter((p) => !p.startsWith("docs/pm/"));
    return outside.length === 0
      ? pass(`${ctx.changedPaths.length} changed path(s), all under docs/pm/`)
      : fail(`outside docs/pm: ${outside.join(", ")}`);
  },
};

export const committed: Check = {
  id: "committed",
  kind: "contract",
  description: "at least one new commit exists and the working tree is clean",
  async run(ctx) {
    if (ctx.newCommits === 0) return fail("no commits since baseline");
    if (ctx.dirty) return fail(`${ctx.newCommits} commit(s) but the working tree is dirty`);
    return pass(`${ctx.newCommits} commit(s), clean tree`);
  },
};

export const checkNoErrors: Check = {
  id: "check-no-errors",
  kind: "contract",
  description: "the skill's checker reports zero errors",
  async run(ctx) {
    if (!ctx.repo) return fail(NO_REPO);
    const errors = errorsOf(ctx);
    return errors.length === 0
      ? pass(`0 errors, ${ctx.findings.length} warning(s)`)
      : fail(errors.map((e) => `${e.rule} ${e.file}`).join("; "));
  },
};

export const indexPresent: Check = {
  id: "index-present",
  kind: "contract",
  description: "INDEX.md exists with a row for every epic",
  async run(ctx) {
    if (!ctx.repo || emptyRepo(ctx)) return fail(NO_REPO);
    if (ctx.repo.index === null) return fail("docs/pm/INDEX.md missing");
    const index = ctx.repo.index;
    const missing = ctx.repo.epics.filter((e) => !index.includes(`[${e.slug}](`));
    return missing.length === 0
      ? pass(`rows for ${ctx.repo.epics.map((e) => e.slug).join(", ") || "no epics"}`)
      : fail(`no INDEX row for ${missing.map((e) => e.slug).join(", ")}`);
  },
};

export const memoPresent: Check = {
  id: "memo-present",
  kind: "contract",
  description: "pmanager-memo.md exists",
  async run(ctx) {
    if (!ctx.repo || emptyRepo(ctx)) return fail(NO_REPO);
    return ctx.repo.memo ? pass(ctx.repo.memo.path) : fail("docs/pm/pmanager-memo.md missing");
  },
};

export function logEntry(kind: string): Check {
  return {
    id: "log-entry",
    kind: "contract",
    description: `a docs/pm/log entry of kind ${kind} exists`,
    async run(ctx: CheckContext) {
      if (!ctx.repo || emptyRepo(ctx)) return fail(NO_REPO);
      const hit = ctx.repo.logs.find((l) => l.kind === kind);
      return hit ? pass(hit.path) : fail(`no log entry with kind: ${kind} in docs/pm/log`);
    },
  };
}

export function commonChecks(logKind: string): Check[] {
  return [scopedDiff, committed, checkNoErrors, indexPresent, memoPresent, logEntry(logKind)];
}
