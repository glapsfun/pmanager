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

const FIELD = /\btotal_cents\b|\bamount_cents\b|\bcurrency\b/;
const KEEPS =
  /\bkeep|\balongside\b|\bboth\b|\bdeprecat|\bin addition to\b|\bbackward compatible\b|\bstill returns\b/i;
const REMOVES_FIELD =
  /\b(?:remov|drop|delet|replac|renam)\w*\b[^\n]{0,60}\btotal_cents\b|\btotal_cents\b[^\n]{0,40}\b(?:is|are|gets?)\s+(?:removed|dropped|deleted|replaced|renamed)\b/i;

function webshopChanges(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => inRepo(t, "webshop") && FIELD.test(work(t)));
}

function webshopRollouts(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => {
    const text = work(t);
    if (
      inRepo(t, "argocd") &&
      NAMES.webshop.test(text) &&
      /\bnewTag\b|\bkustomization\b/.test(text)
    ) {
      return true;
    }
    return (
      inRepo(t, "webshop") && FIELD.test(text) && RELEASES.test(text) && /\bnewTag\b/.test(text)
    );
  });
}

function removals(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => {
    const text = work(t);
    return inRepo(t, "orders") && REMOVES_FIELD.test(text) && !KEEPS.test(text);
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

function switches(e: EpicRecord): TaskDoc[] {
  return live(e).filter((t) => {
    if (!inRepo(t, "argocd")) return false;
    const text = work(t);
    return (
      /\bASSETS_BUCKET\b/.test(text) ||
      ((/\bdeployment\.ya?ml\b/.test(text) || /\bwebshop\s+deployment\b/i.test(text)) &&
        (text.includes(NEW_BUCKET) || /\bbucket\b/i.test(text)))
    );
  });
}

const infraTasks = (e: EpicRecord, re: RegExp) =>
  live(e).filter((t) => inRepo(t, "infra") && re.test(work(t)));

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
