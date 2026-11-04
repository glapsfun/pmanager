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

const SIGNALS: Record<Target, RegExp> = {
  webshop:
    /\b(?:main(?:_test)?\.go|go\.mod|Makefile|Dockerfile)\b|`?webshop`?\s+repo\b|\bGo\s+(?:service|handler|code)\b/i,
  infra: /\benvs\/|\bmodules\/|\.tf\b|\bhcloud_\w+|`?infra`?\s+repo\b/i,
  argocd: /\bapps\/|\bworkloads\/|\bkustomization\b|\bApplication\b|`?argocd`?\s+repo\b/,
};

const OWN_CHECKS: Record<Target, RegExp> = {
  webshop: /\bmake\s+(?:test|lint)\b|\bgo\s+test\b|\bgolangci-lint\b/i,
  infra: /\bterraform\s+(?:validate|fmt)\b|\btflint\b/i,
  argocd: /\byamllint\b|\bkubeconform\b/i,
};

const MANAGER_COMMANDS = /\bbun\s+run\s+lint\b|\bbun\s+test\b/i;
const HAND_APPLY = /\bterraform\s+apply\b|\bkubectl\s+apply\b/i;
// A line that names an apply only to forbid it, or to leave it to CI, is not an instruction to run it.
const NEGATED = /\b(?:never|not|no|don't|do not|without|instead of|CI|pipeline)\b/i;
const VIA_CI =
  /\b(?:CI|pipeline|pull request|PR)\b[^.\n]*\b(?:plan|appl(?:y|ies))\b|\b(?:plan|appl(?:y|ies))\b[^.\n]*\b(?:CI|pipeline|pull request|PR)\b/i;
const SWITCHES_TRAFFIC = /\b10%|\bweight\b|\btraffic\b|\bnewTag\b|\bimage tag\b/i;
const RELEASES = /\brelease\b|\btag\s+v?\d|\bv\d+\.\d+|\bpublish/i;
const LOAD_BALANCER = /\bload balancer\b|\bhcloud_load_balancer\b|\bLB\b/i;

/** What the task does: its title and the work, never Context or Out of scope, which name other repos. */
function work(t: TaskDoc): string {
  return [
    getString(t.frontmatter, "title") ?? "",
    sectionBody(t.body, "What to do") ?? "",
    sectionBody(t.body, "Acceptance criteria") ?? "",
  ].join("\n");
}

export function targetsOf(t: TaskDoc): Target[] {
  const text = work(t);
  return (Object.keys(SIGNALS) as Target[]).filter((name) => SIGNALS[name].test(text));
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
      if (tasks.length === 0) return fail(`no task works in ${name}`);
      const hit = tasks.find((t) => OWN_CHECKS[name].test(work(t)));
      return hit
        ? pass(`${hit.id} names ${name}'s checks`)
        : fail(`${tasks.map((t) => t.id).join(", ")} name none of ${name}'s checks`);
    },
  );
}

const noManagerCommands = epicCheck(
  "no-manager-commands",
  "outcome",
  "every target has a task, and no target task names the manager's bun commands",
  (e): CheckResult => {
    const missing = (Object.keys(TARGETS) as Target[]).filter((n) => tasksFor(e, n).length === 0);
    if (missing.length > 0) return fail(`no task works in ${missing.join(", ")}`);
    const leaked = e.tasks.filter((t) => targetsOf(t).length > 0 && MANAGER_COMMANDS.test(work(t)));
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
    const byHand = e.tasks.filter((t) =>
      work(t)
        .split("\n")
        .some((line) => HAND_APPLY.test(line) && !NEGATED.test(line)),
    );
    if (byHand.length > 0) {
      return fail(`${byHand.map((t) => t.id).join(", ")} run an apply by hand`);
    }
    const viaCi = infra.find((t) => VIA_CI.test(work(t)));
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
    const switches = tasksFor(e, "argocd").filter((t) => SWITCHES_TRAFFIC.test(work(t)));
    if (switches.length === 0) return fail("no argocd task switches traffic or bumps the tag");
    const releases = tasksFor(e, "webshop").filter((t) => RELEASES.test(work(t)));
    const balancers = tasksFor(e, "infra").filter((t) => LOAD_BALANCER.test(work(t)));
    if (releases.length === 0) return fail("no webshop release task");
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
