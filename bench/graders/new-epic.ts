import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { fail, pass } from "./common";
import { newEpics } from "./context";
import type { Check, CheckContext, CheckResult } from "./types";

const TASK_FIELDS = ["id", "epic", "milestone", "status", "depends-on"];
const WINDOW = /\b(d|day|days|week|weeks|wk|h|hour|hours|sprint|sprints|month|months)\b/i;
const RISKY = /profil|benchmark|measur|confirm|reproduc/i;

function single(ctx: CheckContext): EpicRecord | CheckResult {
  if (!ctx.repo) return fail("docs/pm is missing or unreadable");
  const epics = newEpics(ctx);
  if (epics.length !== 1) {
    return fail(
      `expected 1 new epic, found ${epics.length}: ${epics.map((e) => e.slug).join(", ")}`,
    );
  }
  return epics[0] as EpicRecord;
}

function isResult(x: EpicRecord | CheckResult): x is CheckResult {
  return "passed" in x;
}

function epicCheck(id: string, description: string, fn: (e: EpicRecord) => CheckResult): Check {
  return {
    id,
    description,
    async run(ctx) {
      const e = single(ctx);
      return isResult(e) ? e : fn(e);
    },
  };
}

export const epicAndPlan = epicCheck(
  "epic-and-plan",
  "exactly one new epic with epic.md and plan.md",
  (e) =>
    e.epic && e.plan
      ? pass(e.dir)
      : fail(
          `${e.slug}: epic.md ${e.epic ? "ok" : "missing"}, plan.md ${e.plan ? "ok" : "missing"}`,
        ),
);

export const tasksMin3 = epicCheck(
  "tasks-min-3",
  "at least three tasks with the traceability chain",
  (e) => {
    if (e.tasks.length < 3) return fail(`${e.tasks.length} task file(s)`);
    const broken = e.tasks.filter((t) => TASK_FIELDS.some((f) => !(f in t.frontmatter)));
    return broken.length === 0
      ? pass(`${e.tasks.length} tasks with ${TASK_FIELDS.join(", ")}`)
      : fail(`missing fields in ${broken.map((t) => t.id).join(", ")}`);
  },
);

export const binaryAcceptance = epicCheck(
  "binary-acceptance",
  "every task has checkbox acceptance criteria",
  (e) => {
    const bad = e.tasks.filter(
      (t) => !/^\s*- \[[ x]\]/im.test(sectionBody(t.body, "Acceptance criteria") ?? ""),
    );
    return bad.length === 0 && e.tasks.length > 0
      ? pass("all tasks have - [ ] acceptance lines")
      : fail(
          `no checkbox acceptance criteria in ${bad.map((t) => t.id).join(", ") || "(no tasks)"}`,
        );
  },
);

export const evidenceCitesRepo = epicCheck(
  "evidence-cites-repo",
  "Evidence cites app/app.py, schema.sql, or the pagination commit",
  (e) => {
    const ev = sectionBody(e.epic?.body ?? "", "Evidence") ?? "";
    const m = ev.match(/app\/app\.py|schema\.sql|pagination/i);
    return m
      ? pass(`evidence mentions ${m[0]}`)
      : fail("Evidence section cites none of app/app.py, schema.sql, pagination");
  },
);

export const metricHasTarget = epicCheck(
  "metric-has-target",
  "a success-metric row has a number and a window",
  (e) => {
    const rows = (sectionBody(e.epic?.body ?? "", "Success metrics") ?? "")
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.startsWith("| :") && !/^\|\s*Metric/i.test(l));
    const hit = rows.find((r) => /\d/.test(r) && WINDOW.test(r));
    return hit
      ? pass(hit.trim())
      : fail(`${rows.length} metric row(s), none with a number and a window`);
  },
);

export const nonGoals = epicCheck("non-goals", "Non-goals section is non-empty", (e) => {
  const body = (sectionBody(e.epic?.body ?? "", "Non-goals") ?? "").trim();
  return body ? pass(body.split("\n")[0] ?? "") : fail("Non-goals section missing or empty");
});

export const draftAwaitsApproval = epicCheck(
  "draft-awaits-approval",
  "epic status is draft",
  (e) => {
    const s = getString(e.epic?.frontmatter ?? {}, "status");
    return s === "draft" ? pass("status: draft") : fail(`status: ${s ?? "(none)"}`);
  },
);

export const riskiestFirst = epicCheck(
  "riskiest-first",
  "the lowest-numbered dependency-free task is a measurement task",
  (e) => {
    const first = [...e.tasks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .find((t) => getList(t.frontmatter, "depends-on").length === 0);
    if (!first) return fail("no task without depends-on");
    const title = getString(first.frontmatter, "title") ?? "";
    return RISKY.test(title)
      ? pass(`${first.id}: ${title}`)
      : fail(`${first.id}: "${title}" is not a profile/benchmark/measure/confirm task`);
  },
);

export const confidenceNotHigh = epicCheck(
  "confidence-not-high",
  "epic confidence is not high",
  (e) => {
    const m = (e.epic?.body ?? "").match(/\*\*Confidence:\*\*\s*(\w+)/i);
    if (!m) return fail("no **Confidence:** line");
    return m[1]?.toLowerCase() === "high"
      ? fail("confidence: high with no usage data")
      : pass(`confidence: ${m[1]}`);
  },
);

export function newEpicChecks(variant: "perf" | "feature"): Check[] {
  if (variant === "perf") {
    return [
      epicAndPlan,
      tasksMin3,
      binaryAcceptance,
      evidenceCitesRepo,
      metricHasTarget,
      nonGoals,
      draftAwaitsApproval,
      riskiestFirst,
    ];
  }
  return [
    epicAndPlan,
    tasksMin3,
    binaryAcceptance,
    metricHasTarget,
    nonGoals,
    draftAwaitsApproval,
    confidenceNotHigh,
  ];
}
