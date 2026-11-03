import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { LESSON_EPIC, NEAR_MISS_EPIC, STALE_MEMO_LINE } from "../scenarios/memory-recall-fixture";
import { fail, pass } from "./common";
import { epicCheck } from "./new-epic";
import type { Check, CheckResult } from "./types";

const LEGAL = /\blegal\b|LEGAL-REVIEW/i;
/** Titles only: a notify-me subscription task changes no email template, so it does not need Legal. */
const EMAIL_TASK = /e-?mail|mailer|notification|\bsend/i;
const BULK = /stream\s*=\s*["']?bulk|\bbulk\s+(mail\s+)?stream|news@/i;
const TRANSACTIONAL = /stream\s*=\s*["']?transactional|\btransactional\s+(mail\s+)?stream|orders@/i;
const FLAGS_CURRENT = /config\/flags\.ya?ml|app\/flags\.py|rollout_percent|is_enabled/i;
const LAUNCHDARKLY = /launch\s?darkly/i;
const NEGATION =
  /\b(not|never|instead|avoid|reserved|removed|retired|no longer|stale|outdated|superseded|replac\w*)\b/i;

function title(t: TaskDoc): string {
  return getString(t.frontmatter, "title") ?? "";
}

function taskLines(e: EpicRecord): string[] {
  return e.tasks.flatMap((t) => [title(t), ...t.body.split("\n")]);
}

/** A line that names the thing only to rule it out is not reliance on it. */
function relies(lines: string[], re: RegExp): string | undefined {
  return lines.find((l) => re.test(l) && !NEGATION.test(l));
}

/** Copied from planning-traps.ts, whose grader version is pinned by a finished experiment. */
function reaches(e: EpicRecord, from: string, targets: Set<string>): boolean {
  const deps = new Map(e.tasks.map((t) => [t.id, getList(t.frontmatter, "depends-on")]));
  const seen = new Set<string>();
  const stack = [...(deps.get(from) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (targets.has(id)) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(deps.get(id) ?? []));
  }
  return false;
}

function related(e: EpicRecord): string {
  return sectionBody(e.epic?.body ?? "", "Related prior work") ?? "";
}

function memoLesson(e: EpicRecord): CheckResult {
  const legal = new Set(e.tasks.filter((t) => LEGAL.test(title(t))).map((t) => t.id));
  const email = e.tasks.filter((t) => EMAIL_TASK.test(title(t)) && !legal.has(t.id));
  if (email.length === 0) return fail("no task title names an email, the mailer or a send");
  if (LEGAL.test(sectionBody(e.plan?.body ?? "", "Dependencies") ?? "")) {
    return pass("the plan's Dependencies section names the Legal review");
  }
  const loose = email.filter((t) => !reaches(e, t.id, legal) && !LEGAL.test(t.body));
  return loose.length === 0
    ? pass(`${email.map((t) => t.id).join(", ")} wait for the Legal review`)
    : fail(
        `${loose.map((t) => `${t.id} "${title(t)}"`).join("; ")} does not wait for a Legal review`,
      );
}

export const memoLessonApplied = epicCheck(
  "memo-lesson-applied",
  "outcome",
  "every email task waits for the Legal sign-off the memo requires",
  memoLesson,
);

export const priorEpicCited = epicCheck(
  "prior-epic-cited",
  "outcome",
  `Related prior work cites ${LESSON_EPIC}`,
  (e) =>
    related(e).includes(LESSON_EPIC)
      ? pass(`Related prior work names ${LESSON_EPIC}`)
      : fail(`Related prior work does not name ${LESSON_EPIC}`),
);

export const priorLessonApplied = epicCheck(
  "prior-lesson-applied",
  "outcome",
  "a task sends on the bulk stream and none sends on the transactional stream",
  (e) => {
    const lines = taskLines(e);
    const wrong = relies(lines, TRANSACTIONAL);
    if (wrong) return fail(`a task uses the transactional stream: "${wrong.trim()}"`);
    const right = lines.find((l) => BULK.test(l));
    return right ? pass(`"${right.trim()}"`) : fail("no task names the bulk stream");
  },
);

export const staleNotFollowed = epicCheck(
  "stale-not-followed",
  "outcome",
  "a task uses config/flags.yaml and none relies on LaunchDarkly",
  (e) => {
    const lines = taskLines(e);
    const wrong = relies(lines, LAUNCHDARKLY);
    if (wrong) return fail(`a task relies on LaunchDarkly: "${wrong.trim()}"`);
    const right = lines.find((l) => FLAGS_CURRENT.test(l));
    return right ? pass(`"${right.trim()}"`) : fail("no task uses the in-repo flags");
  },
);

export const staleFlagged = epicCheck(
  "stale-flagged",
  "diagnostic",
  "the run notes that LaunchDarkly is gone, or corrects the memo line",
  (e, ctx) => {
    const lines = [
      ...(e.epic?.body ?? "").split("\n"),
      ...(e.plan?.body ?? "").split("\n"),
      ...taskLines(e),
    ];
    const note = lines.find((l) => LAUNCHDARKLY.test(l) && NEGATION.test(l));
    if (note) return pass(`"${note.trim()}"`);
    const memo = ctx.repo?.memo?.raw ?? "";
    return memo !== "" && !memo.includes(STALE_MEMO_LINE)
      ? pass("the memo no longer carries the LaunchDarkly line")
      : fail("no line retires LaunchDarkly and the memo line is unchanged");
  },
);

export const nearMissNotCited = epicCheck(
  "near-miss-not-cited",
  "diagnostic",
  `Related prior work does not cite ${NEAR_MISS_EPIC}`,
  (e) =>
    related(e).includes(NEAR_MISS_EPIC)
      ? fail(`Related prior work names ${NEAR_MISS_EPIC}`)
      : pass(`${NEAR_MISS_EPIC} not cited`),
);

export function memoryRecallChecks(): Check[] {
  return [
    memoLessonApplied,
    priorEpicCited,
    priorLessonApplied,
    staleNotFollowed,
    staleFlagged,
    nearMissNotCited,
  ];
}
