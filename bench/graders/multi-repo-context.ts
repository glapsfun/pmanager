import { TARGETS, type TargetName } from "../../ci/e2e/workspace";
import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { sameRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo-url";
import { fail, pass } from "./common";
import { epicCheck } from "./new-epic";
import type { Check, CheckResult } from "./types";

export type Target = TargetName;

/**
 * Paths and artifacts that place a task in a repo. The webshop image name is
 * not one: argocd's kustomization names it too, so it made a canary workload
 * look like the webshop release.
 */
const SIGNALS: Record<Target, RegExp> = {
  webshop:
    /\b(?:main(?:_test)?\.go|go\.mod|Makefile|Dockerfile|release\.yml)\b|\bGo\s+(?:service|handler|code)\b/i,
  infra: /\benvs\/|\bmodules\/|\.tf\b|\bhcloud_\w+/i,
  argocd:
    /\bapps\/|\bworkloads\/|\bkustomization\b|\bApplication\b|\bingress-nginx\b|\bcanary-weight\b/,
};

/**
 * Repo names, used only when no path or artifact places the task, since tasks
 * name other repos in passing. A name inside an identifier (`webshop-canary`)
 * or a channel (`#infra`) names a thing, not the repo.
 */
const NAMES: Record<Target, RegExp> = {
  webshop: /(?<![#\w-])webshop(?![\w-])/i,
  infra: /(?<![#\w-])infra(?![\w-])/i,
  argocd: /(?<![#\w-])argo\s?cd(?![\w-])/i,
};

const OWN_CHECKS: Record<Target, RegExp> = {
  webshop: /\bmake\s+(?:test|lint)\b|\bgo\s+test\b|\bgolangci-lint\b/i,
  infra: /\bterraform\b[^\n.;]*\bvalidate\b|\bterraform\s+fmt\b|\btflint\b/i,
  argocd: /\byamllint\b|\bkubeconform\b/i,
};

const MANAGER_COMMANDS = /\bbun\s+(?:run\s+)?(?:lint|test)\b/i;
const HAND_APPLY = /\bterraform\s+apply\b|\bkubectl\s+apply\b/i;
// A clause that names an apply only to forbid it, dry-run it, hand it to CI, or warn that Argo CD reverts it is not an instruction to run it.
const NEGATED =
  /\b(?:never|not|no|don't|do not|without|instead of|CI|pipeline|PR|pull request|merge[ds]?|workflow|Actions|revert(?:s|ed)?)\b|--dry-run/i;
const VIA_CI =
  /\b(?:CI|pipeline|pull request|PR|workflow|Actions)\b[^.\n]*\b(?:plans?|appl(?:y|ies|ied|ying))\b|\b(?:plans?|appl(?:y|ies|ied|ying))\b[^.\n]*\b(?:CI|pipeline|pull request|PR|workflow|Actions)\b/i;
const SWITCHES_TRAFFIC = /\b10%|\bweight\b|\btraffic\b|\bnewTag\b|\bimage tag\b/i;
// A clause that gives the canary a non-zero weight or share; "no canary-weight yet" does not.
const SETS_SHARE =
  /\b(?:canary-)?weight\b[^.\n]*?\b[1-9]\d*\b|\b(?:send\w*|rout(?:e|es|ed|ing)|shift\w*|mov(?:e|es|ed|ing)|split\w*)\b[^.\n]*?\b[1-9]\d*\s?%/i;
const NO_SHARE = /\b(?:no|not|never|without|yet)\b/i;
const RELEASES = /\breleas(?:e|es|ed|ing)\b|\btag\s+v?\d|\bv\d+\.\d+|\bpublish/i;
const LOAD_BALANCER = /\bload balancer\b|\bhcloud_load_balancer\b|\bLB\b/i;

/** Where a task's repo shows: its title and the work, never Context or Out of scope, which name other repos. */
function work(t: TaskDoc): string {
  return [
    getString(t.frontmatter, "title") ?? "",
    sectionBody(t.body, "What to do") ?? "",
    sectionBody(t.body, "Acceptance criteria") ?? "",
  ].join("\n");
}

/** What the task asks for, Notes included: checks are often listed there. */
function asks(t: TaskDoc): string {
  return `${work(t)}\n${sectionBody(t.body, "Notes") ?? ""}`;
}

/** Where a task may say who applies its change: plans put "CI applies after merge" under Out of scope too. */
function handoff(t: TaskDoc): string {
  return `${asks(t)}\n${sectionBody(t.body, "Out of scope") ?? ""}`;
}

/** Wrapped lines joined, then split into sentences and list items. */
function sentences(text: string): string[] {
  return text
    .replace(/\n(?!\s*(?:[-*]|\d+\.)\s|\s*#|\s*\n)/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function setsShare(t: TaskDoc): boolean {
  return sentences(sectionBody(t.body, "What to do") ?? "").some((sentence) =>
    sentence
      .split(/[;,]|\bbut\b/)
      .some((clause) => SETS_SHARE.test(clause) && !NO_SHARE.test(clause)),
  );
}

function handApplies(text: string): boolean {
  return sentences(text).some((sentence) =>
    sentence
      .split(/[;,]|\bbut\b/)
      .some((clause) => HAND_APPLY.test(clause) && !NEGATED.test(clause)),
  );
}

export function targetsOf(t: TaskDoc): Target[] {
  const text = work(t);
  const names = Object.keys(SIGNALS) as Target[];
  const placed = names.filter((name) => SIGNALS[name].test(text));
  return placed.length > 0 ? placed : names.filter((name) => NAMES[name].test(text));
}

/** Tasks no rule placed, so the hand audit sees what the graders skipped. */
function unplaced(e: EpicRecord): string {
  const ids = e.tasks.filter((t) => targetsOf(t).length === 0).map((t) => t.id);
  return ids.length > 0 ? `; unattributed: ${ids.join(", ")}` : "";
}

function tasksFor(e: EpicRecord, name: Target): TaskDoc[] {
  return e.tasks.filter((t) => targetsOf(t).includes(name));
}

/** True when `from` reaches any of `targets` through depends-on, directly or transitively. */
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

function ownChecks(name: Target): Check {
  return epicCheck(
    `own-checks-${name}`,
    "outcome",
    `a ${name} task names ${name}'s own check commands`,
    (e) => {
      const tasks = tasksFor(e, name);
      if (tasks.length === 0) return fail(`no task works in ${name}${unplaced(e)}`);
      const hit = tasks.find((t) => OWN_CHECKS[name].test(asks(t)));
      return hit
        ? pass(`${hit.id} names ${name}'s checks${unplaced(e)}`)
        : fail(`${tasks.map((t) => t.id).join(", ")} name none of ${name}'s checks${unplaced(e)}`);
    },
  );
}

const noManagerCommands = epicCheck(
  "no-manager-commands",
  "outcome",
  "every target has a task, and no target task names the manager's bun commands",
  (e): CheckResult => {
    const missing = (Object.keys(TARGETS) as Target[]).filter((n) => tasksFor(e, n).length === 0);
    if (missing.length > 0) return fail(`no task works in ${missing.join(", ")}${unplaced(e)}`);
    const leaked = e.tasks.filter((t) => targetsOf(t).length > 0 && MANAGER_COMMANDS.test(asks(t)));
    return leaked.length === 0
      ? pass("target tasks name no manager command")
      : fail(`${leaked.map((t) => t.id).join(", ")} name the manager's bun commands`);
  },
);

const conventions = epicCheck(
  "conventions",
  "outcome",
  "infra changes go through CI or a pull request, and no task runs an apply by hand",
  (e): CheckResult => {
    const infra = tasksFor(e, "infra");
    if (infra.length === 0) return fail("no task works in infra");
    const byHand = e.tasks.filter((t) => handApplies(asks(t)));
    if (byHand.length > 0) {
      return fail(`${byHand.map((t) => t.id).join(", ")} run an apply by hand`);
    }
    const viaCi = infra.find((t) => sentences(handoff(t)).some((x) => VIA_CI.test(x)));
    return viaCi
      ? pass(`${viaCi.id} leaves plan and apply to CI or a pull request`)
      : fail("no infra task routes plan or apply through CI or a pull request");
  },
);

const crossRepoOrder = epicCheck(
  "cross-repo-order",
  "outcome",
  "the argocd traffic or tag task depends on the webshop release and the infra load balancer",
  (e): CheckResult => {
    const candidates = tasksFor(e, "argocd").filter((t) => SWITCHES_TRAFFIC.test(work(t)));
    if (candidates.length === 0) return fail("no argocd task switches traffic or bumps the tag");
    // The switch is the task that gives the canary its share; one after it (a validation, a runbook) also
    // mentions the split and may reach the release without the switch itself waiting for it.
    const weighted = candidates.filter(setsShare);
    const others = (t: TaskDoc) => new Set(weighted.map((w) => w.id).filter((id) => id !== t.id));
    const switches =
      weighted.length > 0 ? weighted.filter((t) => !reaches(e, t.id, others(t))) : candidates;
    const releases = tasksFor(e, "webshop").filter((t) => RELEASES.test(work(t)));
    const balancers = tasksFor(e, "infra").filter((t) => LOAD_BALANCER.test(work(t)));
    if (releases.length === 0) return fail(`no webshop release task${unplaced(e)}`);
    if (balancers.length === 0) return fail("no infra load balancer task");
    // The release and the switch must be separate tasks for the order to mean anything.
    const ordered = switches.find(
      (s) =>
        reaches(e, s.id, new Set(releases.map((t) => t.id).filter((id) => id !== s.id))) &&
        reaches(e, s.id, new Set(balancers.map((t) => t.id).filter((id) => id !== s.id))),
    );
    return ordered
      ? pass(`${ordered.id} depends on the release and the load balancer`)
      : fail(
          `${switches.map((t) => t.id).join(", ")} do not depend on both a separate release and load balancer task`,
        );
  },
);

const reposRegistered = epicCheck(
  "repos-registered",
  "outcome",
  "the epic's repos are exactly the three registered projects",
  (e): CheckResult => {
    const repos = getList(e.epic?.frontmatter ?? {}, "repos");
    const urls = Object.values(TARGETS);
    const missing = urls.filter((u) => !repos.some((r) => sameRepo(r, u)));
    const extra = repos.filter((r) => !urls.some((u) => sameRepo(r, u)));
    return missing.length === 0 && extra.length === 0
      ? pass("repos lists webshop, infra and argocd")
      : fail(`repos missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`);
  },
);

export function multiRepoContextChecks(): Check[] {
  return [
    ownChecks("webshop"),
    ownChecks("infra"),
    ownChecks("argocd"),
    noManagerCommands,
    conventions,
    crossRepoOrder,
    reposRegistered,
  ];
}
