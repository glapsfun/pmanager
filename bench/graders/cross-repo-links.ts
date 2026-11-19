import { getList } from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { fail, pass, skip } from "./common";
import { RELEASES, reaches, work } from "./multi-stack-repo";
import { epicCheck } from "./new-epic";
import type { Check, CheckResult } from "./types";

export type Repo = "orders" | "webshop" | "argocd" | "infra";
const REPOS: Repo[] = ["orders", "webshop", "argocd", "infra"];

const NAMES: Record<Repo, RegExp> = {
  orders: /\borders\b/i,
  webshop: /\bwebshop\b/i,
  argocd: /\bargo\s?cd\b/i,
  infra: /\binfra\b/i,
};
/** Paths only one repo has; a task that names one works there without saying the repo. */
const PATHS: Record<Repo, RegExp> = {
  orders: /\binternal\/orders\b|\bcmd\/orders\b|\bdeploy\/chart\b/i,
  webshop: /\bhistory\.go\b|\/account\/orders\b/i,
  argocd: /\bworkloads\/|\bkustomization\.ya?ml\b|\bnewTag\b/i,
  infra: /\benvs\/prod\b|\bassets\.tf\b/i,
};

const REPO_NAME = "(?:orders|webshop|argo\\s?cd|infra)";
// "webshop unaffected", "no change to webshop": a mention that says the repo is not worked on.
const NEGATED = new RegExp(
  `\\b${REPO_NAME}\\b(?:\\s+(?:is|are|stays|remains))?\\s+(?:not\\s+affected|unaffected|untouched|unchanged)\\b|\\bno\\s+changes?\\s+(?:to|in|for)\\s+${REPO_NAME}\\b`,
  "gi",
);
// "the same change as in orders" names a repo without working there.
const CROSS_REF = new RegExp(
  `\\bsame\\b[^.\\n]{0,40}?\\bas\\s+(?:in\\s+|for\\s+)?${REPO_NAME}\\b|\\b(?:as|like)\\s+(?:in|for)\\s+${REPO_NAME}\\b`,
  "gi",
);

export function reposOf(t: TaskDoc): Repo[] {
  const parts = getList(t.frontmatter, "parts");
  const placed = REPOS.filter((r) => parts.some((p) => p === r || p.startsWith(`${r}/`)));
  if (placed.length > 0) return placed;
  const text = work(t).replace(NEGATED, "").replace(CROSS_REF, "");
  return REPOS.filter((r) => NAMES[r].test(text) || PATHS[r].test(text));
}

const live = (e: EpicRecord) => e.tasks.filter((t) => t.frontmatter.status !== "descoped");
const ids = (ts: TaskDoc[]) => ts.map((t) => t.id).join(", ");
const inRepo = (t: TaskDoc, r: Repo) => reposOf(t).includes(r);

// Go plans name the struct field TotalCents; the new shape is the `total` object.
const FIELD = /\btotal_?cents\b|\bamount_?cents\b|\bcurrency\b|\btotal\s+(?:object|struct)\b/i;
// A search or conditional check does not know the consumer; it is what the atlas would add.
const HEDGE =
  /\bwhether\b|\bif\s+(?:it|webshop|any|they)\b|\bany\s+(?:use|uses|usage|reference|references|consumer|consumers|client|clients)\b|\bgrep\b|\bsearch\w*|\baudit\w*|\bsmoke\b/i;
// A hedged task that also names where the link sits still states it.
const WEBSHOP_LINK =
  /\bhistory(?:_test)?\.go\b|\/account\/orders\b|\border\s+struct\b|\bdecod\w*|\bamount_?cents\b/i;
const hedged = (text: string, link: RegExp) => HEDGE.test(text) && !link.test(text);

// "deprecat" is not here: "remove the deprecated total_cents" removes it.
const REMOVAL_VERB = "(?:remov|drop|delet|replac|renam|destroy|retir)";
// "without removing X", "do not drop X yet", "not yet delete X": the verb is refused, to the end of the sentence.
const NEGATED_ACTION = new RegExp(
  `\\b(?:without|not|never|don't|doesn't)\\s+(?:\\w+\\s+){0,2}?${REMOVAL_VERB}\\w*\\b[^.\\n]*|\\bkeep\\w*\\s+the\\s+old\\s+bucket\\b[^.\\n]*`,
  "gi",
);
const asserted = (text: string) => text.replace(NEGATED_ACTION, "");

// "removes X later in T05", "before removing the old bucket", "T05 removes X" name a removal that
// another task does; the task that says them is not that task.
const MARKER = /\bT\d+\b|\blater\b|\bonce\b|\bafter\b|\buntil\b/i;
const PASSIVE_REMOVAL = new RegExp(
  `\\b(?:is|are|gets?|will\\s+be|to\\s+be)\\s+${REMOVAL_VERB}\\w*\\b`,
  "i",
);
const BEFORE_GERUND = new RegExp(
  `\\b(?:before|until|prior\\s+to|ahead\\s+of)\\b[^.;\\n]{0,20}?\\b${REMOVAL_VERB}\\w*ing\\b[^.;\\n]*`,
  "gi",
);
const TASK_REMOVES = new RegExp(
  `\\bT\\d+\\b\\s+(?:\\w+\\s+)?${REMOVAL_VERB}\\w*\\b[^.;\\n]*`,
  "gi",
);
const SENTENCE_END = /(?<=[.;!?])\s+|\n/;

/** The removals a task asks for itself: negated, forward-referenced and "task X does it" ones dropped. */
function actions(text: string): string {
  return asserted(text)
    .split(SENTENCE_END)
    .filter((s) => !(PASSIVE_REMOVAL.test(s) && MARKER.test(s)))
    .map((s) => s.replace(BEFORE_GERUND, "").replace(TASK_REMOVES, ""))
    .join("\n");
}

const REMOVES_FIELD = new RegExp(
  `\\b${REMOVAL_VERB}\\w*\\b[^\\n]{0,60}\\btotal_cents\\b|\\btotal_cents\\b[^\\n]{0,40}\\b(?:is|are|gets?)\\s+(?:removed|dropped|deleted|replaced|renamed)\\b|\\bstop\\s+(?:returning|serving|emitting)\\b[^\\n]{0,60}\\btotal_cents\\b|\\bno\\s+longer\\s+(?:returns?|includes?|serves?|emits?)\\b[^\\n]{0,60}\\btotal_cents\\b`,
  "i",
);
// The old field has to be the object of the keep: "keep passing" and "both files" keep nothing.
const KEEPS_FIELD = [
  /\b(?:keep\w*|retain\w*|preserv\w*|still\s+(?:return|serv|includ|emit)\w*)\b[^\n.;]{0,30}?\btotal_cents\b/i,
  /\b(?:alongside|in addition to)\b[^\n.;]{0,30}?\btotal_cents\b/i,
  /\btotal_cents\b[^\n.;]{0,30}?\b(?:stays|remains|is kept|are kept|alongside)\b/i,
  /(?<!not\s)\bbackward[- ]compatible\b[^\n.;]{0,40}\btotal_cents\b|\btotal_cents\b[^\n.;]{0,40}(?<!not\s)\bbackward[- ]compatible\b/i,
  /\bboth\s+(?:shapes|fields|formats|versions)\b/i,
];
const keepsField = (text: string) => KEEPS_FIELD.some((re) => re.test(text));

function webshopChanges(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => {
    const text = work(t);
    return inRepo(t, "webshop") && FIELD.test(text) && !hedged(text, WEBSHOP_LINK);
  });
}

/** A rollout counts when it is, or reaches, a webshop change task. */
function webshopRollouts(e: EpicRecord): TaskDoc[] {
  const changes = webshopChanges(e);
  const changeIds = new Set(changes.map((t) => t.id));
  const own = changes.filter((t) => RELEASES.test(work(t)) && /\bnewTag\b/.test(work(t)));
  const argocd = live(e).filter((t) => {
    const text = work(t);
    return (
      inRepo(t, "argocd") &&
      NAMES.webshop.test(text) &&
      /\bnewTag\b|\bkustomization\b/.test(text) &&
      reaches(e, t.id, changeIds)
    );
  });
  return [...new Set([...own, ...argocd])];
}

function removals(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => {
    const text = work(t);
    return inRepo(t, "orders") && REMOVES_FIELD.test(actions(text)) && !keepsField(text);
  });
}

const clientCovered = epicCheck(
  "client-covered",
  "outcome",
  "a live task changes webshop's decoding of the order total",
  (e): CheckResult => {
    const ts = webshopChanges(e);
    return ts.length > 0
      ? pass(`${ids(ts)} change webshop's decoding`)
      : fail("no live webshop task changes how it reads the order total");
  },
);

const clientSafeRollout = epicCheck(
  "client-safe-rollout",
  "outcome",
  "orders stops serving total_cents only after webshop's change is rolled out",
  (e): CheckResult => {
    const gone = removals(e);
    if (gone.length === 0) return pass("no task removes total_cents");
    if (webshopChanges(e).length === 0) {
      return fail(`${ids(gone)} removes total_cents and no task changes webshop`);
    }
    const rollouts = new Set(webshopRollouts(e).map((t) => t.id));
    const early = gone.filter((t) => !reaches(e, t.id, rollouts));
    return early.length === 0
      ? pass(`${ids(gone)} waits for ${[...rollouts].join(", ")}`)
      : fail(`${ids(early)} removes total_cents and reaches no webshop rollout`);
  },
);

const NEW_BUCKET = "pm-example-webshop-media";
const OLD_BUCKET = "pm-example-webshop-assets";
const CREATES = new RegExp(
  `\\b(?:creat|add|provision|introduc)\\w*\\b[^\\n]{0,80}(?:${NEW_BUCKET}|\\bnew\\b[^\\n]{0,20}\\bbucket)`,
  "i",
);
const DELETES = new RegExp(
  `\\b(?:delet|remov|destroy|drop|retir)\\w*\\b[^\\n]{0,80}(?:${OLD_BUCKET}|\\b(?:old|legacy)\\b[^\\n]{0,20}\\bbucket)`,
  "i",
);

// Where the link is stated: the setting itself, or the file that holds it.
const BUCKET_LINK = /\bASSETS_BUCKET\b|\bdeployment\.ya?ml\b/;

/**
 * Whatever sets the bucket name webshop reads: a task naming ASSETS_BUCKET anywhere, or an argocd
 * task naming the new bucket. A bump-only argocd task names neither.
 */
function switches(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => {
    const text = work(t);
    if (hedged(text, BUCKET_LINK)) return false;
    return /\bASSETS_BUCKET\b/.test(text) || (inRepo(t, "argocd") && text.includes(NEW_BUCKET));
  });
}

const infraTasks = (e: EpicRecord, re: RegExp) =>
  live(e).filter((t) => inRepo(t, "infra") && re.test(actions(work(t))));

const consumerCovered = epicCheck(
  "consumer-covered",
  "outcome",
  "a live argocd task changes the bucket name in webshop's deployment",
  (e): CheckResult => {
    const ts = switches(e);
    return ts.length > 0
      ? pass(`${ids(ts)} switch webshop's bucket`)
      : fail("no live argocd task sets the bucket name in webshop's deployment");
  },
);

const switchOrder = epicCheck(
  "switch-order",
  "outcome",
  "create the new bucket, switch webshop to it, then delete the old one",
  (e): CheckResult => {
    const sw = switches(e);
    const creates = infraTasks(e, CREATES);
    const deletes = infraTasks(e, DELETES);
    if (sw.length === 0 && deletes.length === 0) return skip("nothing to order");
    if (sw.length === 0)
      return fail(`${ids(deletes)} deletes the old bucket and no task switches webshop`);
    const made = new Set(creates.map((t) => t.id));
    const swIds = new Set(sw.map((t) => t.id));
    const misses: string[] = [];
    if (made.size > 0) {
      for (const t of sw) {
        if (!reaches(e, t.id, made))
          misses.push(`${t.id} switches without waiting for ${[...made].join(", ")}`);
      }
    }
    for (const t of deletes) {
      if (!reaches(e, t.id, swIds))
        misses.push(`${t.id} deletes the old bucket without waiting for ${[...swIds].join(", ")}`);
    }
    return misses.length === 0
      ? pass(
          `${ids(sw)} follows ${ids(creates) || "no create task"}; ${ids(deletes) || "no delete task"}`,
        )
      : fail(misses.join("; "));
  },
);

export function crossRepoEndpointChecks(): Check[] {
  return [clientCovered, clientSafeRollout];
}

export function crossRepoOutputChecks(): Check[] {
  return [consumerCovered, switchOrder];
}
