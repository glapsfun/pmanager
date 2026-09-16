import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { fail, pass } from "./common";
import { newEpics } from "./context";
import type { Check, CheckContext, CheckKind, CheckResult } from "./types";

const TASK_FIELDS = ["id", "epic", "milestone", "status", "depends-on"];
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

function epicCheck(
  id: string,
  kind: CheckKind,
  description: string,
  fn: (e: EpicRecord, ctx: CheckContext) => CheckResult,
): Check {
  return {
    id,
    kind,
    description,
    async run(ctx) {
      const e = single(ctx);
      return isResult(e) ? e : fn(e, ctx);
    },
  };
}

export const epicAndPlan = epicCheck(
  "epic-and-plan",
  "outcome",
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
  "contract",
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
  "contract",
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
  "outcome",
  "every [path:line] citation in Evidence resolves to a fixture file, and at least one exists",
  (e, ctx) => {
    const ev = sectionBody(e.epic?.body ?? "", "Evidence") ?? "";
    const cited = [...ev.matchAll(/\[([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?::[\d-]+)?\]/g)].map(
      (m) => m[1] as string,
    );
    if (cited.length === 0) return fail("Evidence cites no file path");
    const missing = cited.filter((p) => !existsSync(join(ctx.fixtureDir, p)));
    return missing.length === 0
      ? pass(`cites ${cited.join(", ")}`)
      : fail(`cited paths not in the repo: ${missing.join(", ")}`);
  },
);

const TARGET = /[<>≤≥=]\s*\d|\d+(\.\d+)?\s*(%|ms|s|x|k)?\b/;
const DURATION =
  /\b\d+\s*(d|day|days|week|weeks|wk|h|hour|hours|sprint|sprints|month|months)\b|\bpost-ship\b/i;

function tableRows(section: string): { header: string[]; rows: string[][] } {
  const lines = section.split("\n").filter((l) => l.trim().startsWith("|"));
  const cells = (l: string) =>
    l
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
  const header = lines[0] ? cells(lines[0]).map((h) => h.toLowerCase()) : [];
  const rows = lines.slice(2).map(cells);
  return { header, rows };
}

export const metricHasTarget = epicCheck(
  "metric-has-target",
  "outcome",
  "the primary success-metric row has a numeric target and a duration window",
  (e) => {
    const { header, rows } = tableRows(sectionBody(e.epic?.body ?? "", "Success metrics") ?? "");
    const role = header.indexOf("role");
    const target = header.indexOf("target");
    const window = header.indexOf("window");
    if (role === -1 || target === -1 || window === -1) {
      return fail("metrics table lacks Role, Target or Window columns");
    }
    const primary = rows.find((r) => (r[role] ?? "").toLowerCase() === "primary");
    if (!primary) return fail("no row with Role = primary");
    const t = primary[target] ?? "";
    const w = primary[window] ?? "";
    if (!TARGET.test(t)) return fail(`primary target is not numeric: "${t}"`);
    if (!DURATION.test(w)) return fail(`primary window is not a duration: "${w}"`);
    return pass(`target ${t}, window ${w}`);
  },
);

export const nonGoals = epicCheck("non-goals", "outcome", "Non-goals section is non-empty", (e) => {
  const body = (sectionBody(e.epic?.body ?? "", "Non-goals") ?? "").trim();
  return body ? pass(body.split("\n")[0] ?? "") : fail("Non-goals section missing or empty");
});

export const draftAwaitsApproval = epicCheck(
  "draft-awaits-approval",
  "outcome",
  "epic status is draft",
  (e) => {
    const s = getString(e.epic?.frontmatter ?? {}, "status");
    return s === "draft" ? pass("status: draft") : fail(`status: ${s ?? "(none)"}`);
  },
);

export const riskiestFirst = epicCheck(
  "riskiest-first",
  "outcome",
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
  "outcome",
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
