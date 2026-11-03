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

const LEGAL_TITLE = /\blegal\b|LEGAL-REVIEW/i;
const LEGAL_REVIEW = /LEGAL-REVIEW|\blegal\s+(review|sign-?off|approval)/i;
const LEGAL_NEGATION = /\b(no|not|none|never|without|skip\w*|waive\w*)\b|n't\b/i;

// A task ships mail or ramps the flag only when it says so; data model, UI, signup,
// template and monitoring work ships nothing to shoppers by itself.
const SEND_VERB = /\b(send\w*|e-?mail\w*|notify\w*)\b/i;
const AUDIENCE = /\b(shoppers?|subscribers?|customers?)\b/i;
const SEND_WORD = /\bsend\w*\b/i;
const MAIL_OBJECT = /\b(e-?mails?|alerts?|notifications?|messages?|mail)\b/i;
const ROLLOUT =
  /\broll(ing|s|ed)?[\s-]?out\b|\brollout\b|\bramp\w*|\bturn(s|ed|ing)?\s+(\w+\s+)?on\b|\bgo(es|ing)?[\s-]live\b|\d+\s*%\s*(of\s+)?(the\s+)?(shoppers|users|customers|subscribers)/i;
const PREP =
  /\b(tables?|models?|schema|migrations?|api|ui|pages?|buttons?|forms?|sign-?ups?|subscribe|subscriptions?|unsubscribe|templates?|copy|monitor\w*|measur\w*|metrics?|dashboards?|deliverability)\b/i;
const BODY_SEND = /mailer\.send|\bsend\(|stream\s*=/;

const BULK = /stream\s*[=:]\s*["'`]?bulk|["'`]?\bbulk["'`]?\s+(mail\s+)?stream/i;
const TRANSACTIONAL_SEND =
  /stream\s*[=:]\s*["'`]?transactional|\b(send\w*|sent|use[sd]?|using|on|via)\s+(the\s+)?["'`]?transactional["'`]?\s+(mail\s+)?stream/i;
/** Retelling the deals-newsletter incident, or keeping order mail where it is, is not a send instruction. */
const STREAM_HISTORY =
  /newsletter|deals|spam|reverted|order mail|order confirmation|confirm_order/i;
const NEGATION =
  /\b(not|never|no|zero|instead|avoid|reserved|removed|retired|no longer|stale|outdated|superseded|replac\w*|default\w*)\b|n't\b/i;
const STREAM_NEGATION = /\b(only|keeps?|kept|stays?|unchanged)\b|reserved for/i;

const LAUNCHDARKLY = /launch\s?darkly/i;
/** Building on LaunchDarkly, as opposed to naming it while explaining the move away from it. */
const LD_BUILD =
  /\b(creat\w*|add\w*|set\w*|configur\w*|roll(ing|s|ed)?[\s-]?out|rollout)\b.*\blaunch\s?darkly|\blaunch\s?darkly\b.*\b(creat\w*|configur\w*|set up|roll(ing|s|ed)?[\s-]?out|rollout)\b|\blaunch\s?darkly\s+(flags?|rollouts?|dashboard|segments?|toggles?|targeting|percentages?)\b/i;
const LD_NEGATION =
  /\b(gone|dropped|deprecated|decommissioned|obsolete|migrated off)\b|out[- ]of[- ]date|rather than|no launch\s?darkly|contract ended|\bmoved\b.*\b(out of|from)\b/i;
const LD_CONTEXT = /\bmemo\b|flags-in-repo|flags\.(ya?ml|py)|in-repo flags?|\bwrong\b/i;
const FLAGS_CURRENT = /\bflags\.(ya?ml|py)\b|rollout_percent|is_enabled/i;
const LESSON_PHRASE = /deals[\s-]newsletter/i;

function title(t: TaskDoc): string {
  return getString(t.frontmatter, "title") ?? "";
}

function taskLines(e: EpicRecord): string[] {
  return e.tasks.flatMap((t) => [title(t), ...t.body.split("\n")]);
}

function planLines(e: EpicRecord): string[] {
  return (e.plan?.body ?? "").split("\n");
}

function discussesLd(l: string): boolean {
  return NEGATION.test(l) || LD_NEGATION.test(l) || LD_CONTEXT.test(l);
}

function reliesOnLd(l: string): boolean {
  return LAUNCHDARKLY.test(l) && LD_BUILD.test(l) && !discussesLd(l);
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
  return (
    r.includes(LESSON_EPIC) ||
    r.toLowerCase().includes(LESSON_TITLE.toLowerCase()) ||
    LESSON_PHRASE.test(r)
  );
}

function isSendTask(t: TaskDoc): boolean {
  const name = title(t);
  if (
    (SEND_VERB.test(name) && AUDIENCE.test(name)) ||
    (SEND_WORD.test(name) && MAIL_OBJECT.test(name)) ||
    ROLLOUT.test(name)
  ) {
    return true;
  }
  if (PREP.test(name)) return false;
  return BODY_SEND.test(t.body);
}

/** "none (no legal dependencies)" or "no legal review needed" must not count as planning one. */
function namesReview(text: string): boolean {
  return text.split("\n").some((l) => LEGAL_REVIEW.test(l) && !LEGAL_NEGATION.test(l));
}

function isLegalTask(t: TaskDoc): boolean {
  const name = title(t);
  return (LEGAL_TITLE.test(name) && !LEGAL_NEGATION.test(name)) || namesReview(t.body);
}

function memoLesson(e: EpicRecord): CheckResult {
  if (namesReview(sectionBody(e.plan?.body ?? "", "Dependencies") ?? "")) {
    return pass("the plan's Dependencies section names the Legal review");
  }
  const send = e.tasks.filter(isSendTask);
  if (send.length === 0) return fail("no task sends mail to shoppers or rolls the feature out");
  const legal = new Set(e.tasks.filter(isLegalTask).map((t) => t.id));
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
  "every task that sends to shoppers or rolls out waits for the Legal sign-off the memo requires",
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
        !BULK.test(l) &&
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
  "a task uses the in-repo flags and neither the tasks nor the plan build on LaunchDarkly",
  (e) => {
    const wrong = [...taskLines(e), ...planLines(e)].find(reliesOnLd);
    if (wrong) return fail(`builds on LaunchDarkly: "${wrong.trim()}"`);
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
    const note = lines.find((l) => LAUNCHDARKLY.test(l) && discussesLd(l));
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
