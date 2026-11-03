import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import {
  LESSON_EPIC,
  LESSON_TITLE,
  NEAR_MISS_EPIC,
  PRIOR_EPICS,
  STALE_MEMO_LINE,
} from "../scenarios/memory-recall-fixture";
import { fail, pass } from "./common";
import { epicCheck } from "./new-epic";
import type { Check, CheckResult } from "./types";

const LEGAL = /\blegal\b|LEGAL-REVIEW/i;
/** Work that puts mail in front of shoppers; "notify me" names the opt-in button, not a send. */
const SEND_TITLE =
  /\bsend|dispatch|deliver|notification|\bnotify\b(?![- ]me)|roll\s?-?out|enable|launch/i;
const SEND_BODY = /mailer\.send/;
/** Writing a template or copy, or capturing opt-ins, ships nothing to shoppers by itself. */
const PREP_TITLE = /\btemplate\b|\bcopy\b|\bcapture\b/i;
const SEND_VERB = /\b(send|dispatch|deliver)/i;

const BULK = /stream\s*[=:]\s*["'`]?bulk|["'`]?\bbulk["'`]?\s+(mail\s+)?stream|news@/i;
const TRANSACTIONAL_SEND =
  /stream\s*[=:]\s*["'`]?transactional|\b(send\w*|sent|use[sd]?|using|on|via)\s+(the\s+)?["'`]?transactional["'`]?\s+(mail\s+)?stream/i;
/** Retelling the deals-newsletter incident, or keeping order mail where it is, is not a send instruction. */
const STREAM_HISTORY =
  /newsletter|deals|spam|reverted|order mail|order confirmation|confirm_order/i;
const NEGATION =
  /\b(not|never|instead|avoid|reserved|removed|retired|no longer|stale|outdated|superseded|replac\w*)\b/i;
const STREAM_NEGATION = /\b(only|keeps?|kept|stays?|unchanged)\b|reserved for/i;
const LD_NEGATION =
  /\b(gone|dropped|deprecated|decommissioned|obsolete)\b|out of date|rather than|no launch\s?darkly|contract ended|\bmoved\b.*\bout of\b/i;

const FLAGS_CURRENT = /\bflags\.ya?ml\b|app\/flags\.py|rollout_percent|is_enabled/i;
const LAUNCHDARKLY = /launch\s?darkly/i;

function title(t: TaskDoc): string {
  return getString(t.frontmatter, "title") ?? "";
}

function taskLines(e: EpicRecord): string[] {
  return e.tasks.flatMap((t) => [title(t), ...t.body.split("\n")]);
}

function planLines(e: EpicRecord): string[] {
  return (e.plan?.body ?? "").split("\n");
}

function ruledOutLd(l: string): boolean {
  return NEGATION.test(l) || LD_NEGATION.test(l);
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

function citesLesson(e: EpicRecord): boolean {
  const r = related(e);
  return r.includes(LESSON_EPIC) || r.toLowerCase().includes(LESSON_TITLE.toLowerCase());
}

function isSendTask(t: TaskDoc): boolean {
  const name = title(t);
  if (PREP_TITLE.test(name) && !SEND_VERB.test(name)) return false;
  return SEND_TITLE.test(name) || SEND_BODY.test(t.body);
}

function memoLesson(e: EpicRecord): CheckResult {
  if (LEGAL.test(sectionBody(e.plan?.body ?? "", "Dependencies") ?? "")) {
    return pass("the plan's Dependencies section names the Legal review");
  }
  const send = e.tasks.filter(isSendTask);
  if (send.length === 0) return fail("no task sends, notifies or rolls out to shoppers");
  const legal = new Set(
    e.tasks.filter((t) => LEGAL.test(title(t)) || LEGAL.test(t.body)).map((t) => t.id),
  );
  const loose = send.filter((t) => !legal.has(t.id) && !reaches(e, t.id, legal));
  return loose.length === 0
    ? pass(`${send.map((t) => t.id).join(", ")} wait for the Legal review`)
    : fail(
        `${loose.map((t) => `${t.id} "${title(t)}"`).join("; ")} does not wait for a Legal review`,
      );
}

export const memoLessonApplied = epicCheck(
  "memo-lesson-applied",
  "outcome",
  "every task that sends to shoppers waits for the Legal sign-off the memo requires",
  memoLesson,
);

export const priorEpicCited = epicCheck(
  "prior-epic-cited",
  "outcome",
  `Related prior work cites ${LESSON_EPIC}`,
  (e) =>
    citesLesson(e)
      ? pass(`Related prior work names ${LESSON_EPIC}`)
      : fail(`Related prior work does not name ${LESSON_EPIC}`),
);

export const priorLessonApplied = epicCheck(
  "prior-lesson-applied",
  "outcome",
  "a task sends on the bulk stream and none sends on the transactional stream",
  (e) => {
    const lines = taskLines(e);
    const wrong = lines.find(
      (l) =>
        TRANSACTIONAL_SEND.test(l) &&
        !STREAM_HISTORY.test(l) &&
        !NEGATION.test(l) &&
        !STREAM_NEGATION.test(l),
    );
    if (wrong) return fail(`a task sends on the transactional stream: "${wrong.trim()}"`);
    const right = lines.find((l) => BULK.test(l));
    return right ? pass(`"${right.trim()}"`) : fail("no task names the bulk stream");
  },
);

export const staleNotFollowed = epicCheck(
  "stale-not-followed",
  "outcome",
  "a task uses the in-repo flags and neither the tasks nor the plan rely on LaunchDarkly",
  (e) => {
    const wrong = [...taskLines(e), ...planLines(e)].find(
      (l) => LAUNCHDARKLY.test(l) && !ruledOutLd(l),
    );
    if (wrong) return fail(`relies on LaunchDarkly: "${wrong.trim()}"`);
    const right = taskLines(e).find((l) => FLAGS_CURRENT.test(l));
    return right ? pass(`"${right.trim()}"`) : fail("no task uses the in-repo flags");
  },
);

export const staleFlagged = epicCheck(
  "stale-flagged",
  "diagnostic",
  "the run notes that LaunchDarkly is gone, or corrects the memo line",
  (e, ctx) => {
    const lines = [...(e.epic?.body ?? "").split("\n"), ...planLines(e), ...taskLines(e)];
    const note = lines.find((l) => LAUNCHDARKLY.test(l) && ruledOutLd(l));
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
  `Related prior work does not cite ${NEAR_MISS_EPIC} in place of ${LESSON_EPIC}`,
  (e) =>
    related(e).includes(NEAR_MISS_EPIC) && !citesLesson(e)
      ? fail(`Related prior work names ${NEAR_MISS_EPIC} but not ${LESSON_EPIC}`)
      : pass(`${NEAR_MISS_EPIC} not cited in place of ${LESSON_EPIC}`),
);

/** The common log-entry check passes on the prior epics' own spec logs in this warm fixture. */
export const newSpecLog: Check = {
  id: "new-spec-log",
  kind: "contract",
  description: "a docs/pm/log entry of kind spec names the new epic",
  async run(ctx) {
    const hit = (ctx.repo?.logs ?? []).find(
      (l) => l.kind === "spec" && !PRIOR_EPICS.includes(l.epic),
    );
    return hit ? pass(hit.path) : fail("no spec log entry for an epic other than the prior ones");
  },
};

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
