import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getList,
  getString,
  type HistoryEntry,
  parseHistory,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import { TASKS_END, TASKS_START } from "../../plugins/pmanager/skills/pmanager/scripts/render";
import {
  type EpicRecord,
  epicBySlug,
  type TaskDoc,
  taskById,
} from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { fail, pass, skip } from "./common";
import { newEpics } from "./context";
import type { Check, CheckContext, CheckKind, CheckResult } from "./types";

const SLUG = "app-performance";

function epic(ctx: CheckContext): EpicRecord | CheckResult {
  if (!ctx.repo) return fail("docs/pm is missing or unreadable");
  const e = epicBySlug(ctx.repo, SLUG);
  return e ?? fail(`epic ${SLUG} not found`);
}

function isResult(x: EpicRecord | TaskDoc | CheckResult): x is CheckResult {
  return "passed" in x;
}

function task(ctx: CheckContext, id: string): TaskDoc | CheckResult {
  const e = epic(ctx);
  if (isResult(e)) return e;
  return taskById(e, id) ?? fail(`${id} not found in ${SLUG}`);
}

function taskCheck(
  id: string,
  kind: CheckKind,
  description: string,
  taskId: string,
  fn: (t: TaskDoc) => CheckResult,
): Check {
  return {
    id,
    kind,
    description,
    async run(ctx) {
      const t = task(ctx, taskId);
      return isResult(t) ? t : fn(t);
    },
  };
}

export const noNewEpic: Check = {
  id: "no-new-epic",
  kind: "outcome",
  description: "no epic directory was added",
  async run(ctx) {
    const added = newEpics(ctx);
    return added.length === 0
      ? pass("epic set unchanged")
      : fail(`new epic(s): ${added.map((e) => e.slug).join(", ")}`);
  },
};

export const t01Done = taskCheck(
  "t01-done",
  "outcome",
  "T01 is done and its updated date advanced",
  "T01",
  (t) => {
    const status = getString(t.frontmatter, "status");
    const updated = getString(t.frontmatter, "updated");
    if (status !== "done") return fail(`T01 status: ${status ?? "(none)"}`);
    return updated && updated > "2026-09-10"
      ? pass(`done, updated ${updated}`)
      : fail(`updated not advanced: ${updated ?? "(none)"}`);
  },
);

export const t02BlockedNoted = taskCheck(
  "t02-blocked-noted",
  "outcome",
  "T02 is blocked and names the DBA review",
  "T02",
  (t) => {
    const status = getString(t.frontmatter, "status");
    if (status !== "blocked") return fail(`T02 status: ${status ?? "(none)"}`);
    return /DBA/i.test(t.body)
      ? pass("blocked, DBA mentioned")
      : fail("blocked but no DBA mention in the task body");
  },
);

export const tableMirrors: Check = {
  id: "table-mirrors",
  kind: "contract",
  description: "the rendered plan task table shows T01 done and T02 blocked",
  async run(ctx) {
    const e = epic(ctx);
    if (isResult(e)) return e;
    const raw = e.plan?.raw ?? "";
    const start = raw.indexOf(TASKS_START);
    const end = raw.indexOf(TASKS_END);
    if (start === -1 || end === -1) return fail("plan.md has no rendered task table markers");
    const table = raw.slice(start, end);
    const row = (id: string) => table.split("\n").find((l) => l.startsWith(`| ${id} `)) ?? "";
    const ok = /\| done \|\s*$/.test(row("T01")) && /\| blocked \|\s*$/.test(row("T02"));
    return ok
      ? pass("table rows match task frontmatter")
      : fail(`rows: ${row("T01").trim()} / ${row("T02").trim()}`);
  },
};

export const indexCounts: Check = {
  id: "index-counts",
  kind: "contract",
  description: "INDEX row shows 1/4 tasks done",
  async run(ctx) {
    if (!ctx.repo?.index) return fail("docs/pm/INDEX.md missing");
    const row = ctx.repo.index.split("\n").find((l) => l.includes(`[${SLUG}](`)) ?? "";
    return row.includes("| 1/4 |") ? pass(row.trim()) : fail(`row: ${row.trim() || "(missing)"}`);
  },
};

function readyIds(e: EpicRecord): Set<string> {
  const status = new Map(e.tasks.map((t) => [t.id, getString(t.frontmatter, "status") ?? ""]));
  return new Set(
    e.tasks
      .filter(
        (t) =>
          status.get(t.id) === "todo" &&
          getList(t.frontmatter, "depends-on").every((d) => status.get(d) === "done"),
      )
      .map((t) => t.id),
  );
}

/** Ids in a clause count as recommendations unless that clause says something waits or is blocked. */
function recommendedIds(paragraph: string): string[] {
  const out: string[] = [];
  for (const clause of paragraph.split(/[.!?;,()]+/)) {
    if (/\b(wait|waits|waiting|blocked|blocks)\b/i.test(clause)) continue;
    for (const m of clause.matchAll(/\bT\d{2}\b/g)) out.push(m[0]);
  }
  return [...new Set(out)];
}

export const nextNotT03: Check = {
  id: "next-not-t03",
  kind: "diagnostic",
  description: "the recommended next task is unblocked per depends-on",
  async run(ctx) {
    const msg = ctx.telemetry.finalMessage;
    if (msg === null) return skip("harness reported no final message");
    const e = epic(ctx);
    if (isResult(e)) return e;
    const last =
      msg
        .trim()
        .split(/\n\s*\n/)
        .pop() ?? "";
    const recommended = recommendedIds(last);
    if (recommended.length === 0) return fail("final message recommends no task id");
    const ready = readyIds(e);
    const blocked = recommended.filter((id) => !ready.has(id));
    return blocked.length === 0
      ? pass(`recommends ${recommended.join(", ")}, all unblocked`)
      : fail(`recommends blocked task(s): ${blocked.join(", ")}`);
  },
};

export const verifiedEvidence = taskCheck(
  "verified-evidence",
  "outcome",
  "T01 references profile-results.txt and criteria are checked or marked unverified",
  "T01",
  (t) => {
    const acceptance = sectionBody(t.body, "Acceptance criteria") ?? "";
    const checked = /- \[x\]/i.test(acceptance) || /\*\*unverified\*\*/.test(t.body);
    const cited = /profile-results/.test(t.raw);
    if (!cited) return fail("T01 does not reference docs/profile-results.txt");
    return checked
      ? pass("criteria checked or marked unverified, evidence cited")
      : fail("criteria neither checked nor marked **unverified**");
  },
);

export const toolVerifyUsed: Check = {
  id: "tool-verify-used",
  kind: "diagnostic",
  description: "the done claim was checked with pm verify",
  async run(ctx) {
    const cmds = ctx.telemetry.commands;
    if (cmds === null) return skip("harness reported no commands");
    const hit = cmds.find((c) => /\bpm\.ts\b[^\n]*\bverify\b/.test(c));
    return hit ? pass(hit) : fail(`${cmds.length} command(s), none ran pm verify`);
  },
};

export function trackingChecks(): Check[] {
  return [
    noNewEpic,
    t01Done,
    t02BlockedNoted,
    tableMirrors,
    indexCounts,
    nextNotT03,
    verifiedEvidence,
    toolVerifyUsed,
  ];
}

/** Planted in the tracking scenario's attempt log; it must never be copied into docs/pm. */
export const FIXTURE_SECRET = "s3cr3t-fixture-value";
/**
 * Strings only a pasted log holds. A short summary may name the error, the command or the
 * variable, so "database is locked", "python scripts/seed.py" and a bare "SHOP_DB_PASSWORD"
 * are left out on purpose.
 */
export const RAW_LOG_MARKERS: readonly string[] = [
  FIXTURE_SECRET,
  "Traceback (most recent call last)",
  "$ python scripts/seed.py",
  'File "scripts/seed.py", line',
  "env: SHOP_DB_PASSWORD=",
];

function describeEntry(h: HistoryEntry): string {
  return h.kind === "status" ? `${h.from} -> ${h.to}` : "attempt";
}

export const t01HistoryAttempt = taskCheck(
  "t01-history-attempt",
  "outcome",
  "T01 History records the failed attempt with its evidence path",
  "T01",
  (t) => {
    const h = parseHistory(t.body);
    if (!h) return fail("T01 has no ## History section");
    if (h.invalid.length > 0) return fail(`invalid History line(s): ${h.invalid.join(" | ")}`);
    const hit = h.entries.find(
      (e) =>
        e.kind === "attempt" &&
        /lock/i.test(`${e.tried} ${e.got}`) &&
        /attempt-1\.log/.test(e.evidence),
    );
    return hit
      ? pass("attempt line names the lock and docs/attempt-1.log")
      : fail("no attempt line about the lock with docs/attempt-1.log");
  },
);

export const t01HistorySequence = taskCheck(
  "t01-history-sequence",
  "outcome",
  "T01 History goes to in-progress, records the attempt, then done with fixed by",
  "T01",
  (t) => {
    const h = parseHistory(t.body);
    if (!h) return fail("T01 has no ## History section");
    const seq = h.entries.map(describeEntry).join(", ");
    const statuses = h.entries.filter((e) => e.kind === "status");
    const targets = statuses.map((e) => e.to);
    if (targets.join(",") !== "in-progress,done") return fail(`status lines: ${seq || "(none)"}`);
    const attempt = h.entries.findIndex((e) => e.kind === "attempt");
    const start = h.entries.indexOf(statuses[0] as HistoryEntry);
    const end = h.entries.indexOf(statuses[1] as HistoryEntry);
    if (attempt < start || attempt > end)
      return fail(`attempt not between the status lines: ${seq}`);
    const done = statuses[1];
    return done?.kind === "status" && /transaction/i.test(done.fixedBy ?? "")
      ? pass(seq)
      : fail(`done line lacks "fixed by ... transaction": ${seq}`);
  },
);

export const t02HistoryBlocked = taskCheck(
  "t02-history-blocked",
  "outcome",
  "T02 History records todo -> blocked",
  "T02",
  (t) => {
    const h = parseHistory(t.body);
    if (!h) return fail("T02 has no ## History section");
    if (h.invalid.length > 0) return fail(`invalid History line(s): ${h.invalid.join(" | ")}`);
    const hit = h.entries.some(
      (e) => e.kind === "status" && e.from === "todo" && e.to === "blocked",
    );
    return hit
      ? pass("todo -> blocked recorded")
      : fail(`entries: ${h.entries.map(describeEntry).join(", ") || "(none)"}`);
  },
);

export const noRawLog: Check = {
  id: "no-raw-log",
  kind: "outcome",
  description: "no document under docs/pm copies the attempt log or its secret",
  async run(ctx) {
    const root = join(ctx.fixtureDir, "docs", "pm");
    let names: string[];
    try {
      names = await readdir(root, { recursive: true });
    } catch {
      return fail("docs/pm is missing or unreadable");
    }
    const leaked: string[] = [];
    for (const name of names) {
      let text: string;
      try {
        text = await readFile(join(root, name), "utf8");
      } catch {
        continue;
      }
      if (RAW_LOG_MARKERS.some((m) => text.includes(m))) leaked.push(`docs/pm/${name}`);
    }
    return leaked.length === 0
      ? pass("no log output in docs/pm")
      : fail(`log output in ${leaked.join(", ")}`);
  },
};

export function attemptChecks(): Check[] {
  return [t01HistoryAttempt, t01HistorySequence, t02HistoryBlocked, noRawLog];
}
