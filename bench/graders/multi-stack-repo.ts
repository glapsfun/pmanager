import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { sameRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo-url";
import { fail, pass, skip } from "./common";
import { epicCheck } from "./new-epic";
import type { Check, CheckResult } from "./types";

// A placeholder origin like the example's other targets; nothing fetches it.
export const ORDERS_URL = "https://github.com/pm-example/orders.git";

export type Part = "service" | "terraform" | "chart";
const PARTS: Part[] = ["service", "terraform", "chart"];

/** Paths and artifacts first; the words only when no path places the task. */
const PATHS: Record<Part, RegExp> = {
  service:
    /\bcmd\/|\binternal\/|\.go\b|\bgo\.mod\b|\bMakefile\b|\bDockerfile\b|\bmake\s+release\b|\borders:v?\d/i,
  terraform: /\binfra\/terraform\b|\.tf\b|\baws_s3_bucket\b|\btf-check\b/i,
  chart: /\bdeploy\/chart\b|\bvalues\.ya?ml\b|\bChart\.yaml\b|\bimage\.tag\b/i,
};
const WORDS: Record<Part, RegExp> = {
  service: /\bGo\s+(?:service|handler|code)\b/i,
  terraform: /\bTerraform\b/i,
  chart: /\bHelm\s+chart\b/i,
};
/** The workspace's own infra repo: work there is not the orders Terraform part. */
const SHARED_INFRA = /\benvs\/|\bmodules\/|\binfra repo\b|pm-example\/infra\b/i;
// "in the orders Terraform, not the infra repo" names the shared repo only to rule it out.
const NOT_SHARED = /\b(?:not|never|instead of)\s+(?:in\s+)?the infra repo\b/gi;
/** Changing the service's code; Makefile, image and release words only name where a tag comes from. */
const SERVICE_CODE = /\bcmd\/|\binternal\/|\.go\b|\bgo\.mod\b|\bGo\s+(?:service|handler|code)\b/i;

const OWN_CHECKS: Record<Part, RegExp> = {
  service: /\bmake\s+(?:test|lint)\b|\bgo\s+test\b/i,
  terraform: /\btf-check(?:\.sh)?\b|\bcheckov\b/i,
  chart: /\bhelm\s+unittest\b|\bct\s+lint\b/i,
};
const MANAGER_COMMANDS = /\bbun\s+(?:run\s+)?(?:lint|test)\b/i;
// A substring: plans write exportsBucket, EXPORTS_BUCKET and aws_s3_bucket.exports.
const BUCKET = /bucket/i;
const CREATES_BUCKET = /aws_s3_bucket\b|\b(?:add|create|provision|new)\w*\b[^.\n]*bucket/i;
/** Read only on chart tasks, where a bare "tag" or a versioned image is the image tag. */
const IMAGE_TAG =
  /\bimage\.tag\b|\bimage tag\b|\btag\b|\borders:v?\d|\bimage\b[^.\n]*?\bv?\d+\.\d+/i;
// Release actions, not the word: "ships in the 1.5.0 release" is no release task. An image
// reference has dots (ghcr.io), so a push may reach the image anywhere on its line.
const RELEASES =
  /^\s*release\b|\brelease\s+(?:orders|the service|v?\d)|\bcut\s+(?:v?\d|a release|the release)|\bmake\s+release\b|\btag\s+v?\d|\bpublish\w*\b|\bpush\w*\b[^\n]*?(?:\borders:v?\d|\bimage\b)/im;

/** Where a task's part shows: its title and the work, never Context or Out of scope. */
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

function sharedInfra(t: TaskDoc): boolean {
  const text = work(t).replace(NOT_SHARED, "");
  return SHARED_INFRA.test(text) && !/\binfra\/terraform\b/i.test(text);
}

function sharedBucket(t: TaskDoc): boolean {
  return sharedInfra(t) && CREATES_BUCKET.test(work(t));
}

export function partsOf(t: TaskDoc): Part[] {
  const text = work(t);
  const shared = sharedInfra(t);
  const keep = (p: Part) => !(shared && p === "terraform");
  const placed = PARTS.filter((p) => PATHS[p].test(text) && keep(p));
  return placed.length > 0 ? placed : PARTS.filter((p) => WORDS[p].test(text) && keep(p));
}

/** Tasks no rule placed, so the hand audit sees what the graders skipped. */
function unplaced(e: EpicRecord): string {
  const ids = e.tasks.filter((t) => partsOf(t).length === 0 && !sharedInfra(t)).map((t) => t.id);
  return ids.length > 0 ? `; unattributed: ${ids.join(", ")}` : "";
}

function tasksIn(e: EpicRecord, part: Part): TaskDoc[] {
  return e.tasks.filter((t) => partsOf(t).includes(part));
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

/** The bucket's home, wherever the plan put it: ordering is graded apart from resource-home. */
function bucketTasks(e: EpicRecord): TaskDoc[] {
  return e.tasks.filter(
    (t) => (partsOf(t).includes("terraform") || sharedInfra(t)) && CREATES_BUCKET.test(work(t)),
  );
}

function ownChecks(part: Part): Check {
  return epicCheck(
    `own-checks-${part}`,
    "outcome",
    `a task in the ${part} part names that part's own check commands`,
    (e): CheckResult => {
      const tasks = tasksIn(e, part);
      if (tasks.length === 0) {
        if (part === "terraform" && e.tasks.some(sharedBucket)) {
          return skip(
            "no task works in orders' Terraform; the bucket went to the infra repo (resource-home)",
          );
        }
        return fail(`no task works in the ${part} part${unplaced(e)}`);
      }
      const hit = tasks.find((t) => OWN_CHECKS[part].test(asks(t)));
      return hit
        ? pass(`${hit.id} names the ${part} part's checks${unplaced(e)}`)
        : fail(
            `${tasks.map((t) => t.id).join(", ")} name none of the ${part} part's checks${unplaced(e)}`,
          );
    },
  );
}

const noBorrowedChecks = epicCheck(
  "no-borrowed-checks",
  "outcome",
  "no task that changes only the Terraform part or only the chart names the service's checks",
  (e): CheckResult => {
    const changes = (t: TaskDoc) =>
      partsOf(t).filter((p) => p !== "service" || SERVICE_CODE.test(work(t)));
    const borrowed = e.tasks.filter((t) => {
      const p = changes(t);
      return p.length === 1 && p[0] !== "service" && OWN_CHECKS.service.test(asks(t));
    });
    const several = e.tasks.filter((t) => changes(t).length > 1).map((t) => t.id);
    const unchecked =
      several.length > 0 ? `; not checked, several parts: ${several.join(", ")}` : "";
    return borrowed.length === 0
      ? pass(`no Terraform-only or chart-only task names the service's checks${unchecked}`)
      : fail(
          `${borrowed.map((t) => t.id).join(", ")} name the service's make test or make lint${unchecked}`,
        );
  },
);

const resourceHome = epicCheck(
  "resource-home",
  "outcome",
  "the new bucket is created in orders' own Terraform, not in the infra repo",
  (e): CheckResult => {
    const shared = e.tasks.filter(sharedBucket);
    if (shared.length > 0) {
      return fail(`${shared.map((t) => t.id).join(", ")} create the bucket in the infra repo`);
    }
    const own = bucketTasks(e);
    return own.length > 0
      ? pass(`${own[0]?.id} creates the bucket in orders' infra/terraform/`)
      : fail("no task creates the bucket");
  },
);

const rolloutOrder = epicCheck(
  "rollout-order",
  "outcome",
  "each chart change waits for what it uses: the bucket value for the bucket, the image tag for the release",
  (e): CheckResult => {
    const chart = tasksIn(e, "chart");
    if (chart.length === 0) return fail("no task changes the chart");
    const buckets = new Set(bucketTasks(e).map((t) => t.id));
    const releases = new Set(
      tasksIn(e, "service")
        .filter((t) => RELEASES.test(work(t)))
        .map((t) => t.id),
    );
    const misses: string[] = [];
    const notes: string[] = [];
    // A task that makes both ends of a link (creates the bucket and sets the value, or releases
    // and sets the tag) satisfies it inside itself; the rubric passes it and notes it.
    for (const t of chart) {
      const text = work(t);
      if (BUCKET.test(text)) {
        if (buckets.has(t.id)) notes.push(`${t.id} creates the bucket and sets its value`);
        else if (!reaches(e, t.id, buckets)) {
          misses.push(`${t.id} sets the bucket value without waiting for the bucket`);
        }
      }
      if (IMAGE_TAG.test(text)) {
        if (releases.has(t.id)) notes.push(`${t.id} releases and sets the tag`);
        else if (!reaches(e, t.id, releases)) {
          misses.push(`${t.id} sets the image tag without waiting for the release`);
        }
      }
    }
    if (!chart.some((t) => BUCKET.test(work(t))))
      misses.push("no chart task sets the bucket value");
    if (!chart.some((t) => IMAGE_TAG.test(work(t))))
      misses.push("no chart task sets the image tag");
    const noted = notes.length > 0 ? `; same task: ${notes.join("; ")}` : "";
    return misses.length === 0
      ? pass(`${chart.map((t) => t.id).join(", ")} wait for the bucket and the release${noted}`)
      : fail(`${misses.join("; ")}${noted}`);
  },
);

const reposRegistered = epicCheck(
  "repos-registered",
  "outcome",
  "the epic's repos name orders by its catalog URL",
  (e): CheckResult => {
    const repos = getList(e.epic?.frontmatter ?? {}, "repos");
    return repos.some((r) => sameRepo(r, ORDERS_URL))
      ? pass("repos names orders")
      : fail(`repos ${repos.join(", ") || "(none)"} do not name ${ORDERS_URL}`);
  },
);

const noManagerCommands = epicCheck(
  "no-manager-commands",
  "outcome",
  "an orders task exists, and no orders task names the manager's bun commands",
  (e): CheckResult => {
    const orders = e.tasks.filter((t) => partsOf(t).length > 0);
    if (orders.length === 0) return fail(`no task works in orders${unplaced(e)}`);
    const leaked = orders.filter((t) => MANAGER_COMMANDS.test(asks(t)));
    return leaked.length === 0
      ? pass("orders tasks name no manager command")
      : fail(`${leaked.map((t) => t.id).join(", ")} name the manager's bun commands`);
  },
);

export function multiStackRepoChecks(): Check[] {
  return [
    ownChecks("service"),
    ownChecks("terraform"),
    ownChecks("chart"),
    noBorrowedChecks,
    resourceHome,
    rolloutOrder,
    reposRegistered,
    noManagerCommands,
  ];
}
