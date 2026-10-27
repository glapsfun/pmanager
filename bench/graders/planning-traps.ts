import {
  getList,
  getString,
  sectionBody,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { fail, pass } from "./common";
import { epicCheck } from "./new-epic";
import type { Check } from "./types";

const MIGRATION = /migrat|schema|column|database|\bdb\b/i;
const READER = /\b(page|ui|display|show|render|api|endpoint|expose|ios|app)\b/i;
const VAGUE =
  /\b(nice|nicer|better|smooth(er|ly)?|intuitive|user-friendly|clean(er)?|polish(ed)?|feels?|properly|as expected|looks? good|modern)\b/i;
const COMPATIBLE =
  /_cents\b|expand.{0,40}contract|backwards?[- ]compat|additive|\/v2\b|deprecat|keeps?(ing)? (the )?`?total`?/i;
const CHECKBOX = /^\s*- \[[ x]\]/i;

function title(t: TaskDoc): string {
  return getString(t.frontmatter, "title") ?? "";
}

function label(t: TaskDoc): string {
  return `${t.id} "${title(t)}"`;
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

function dependsOnAll(e: EpicRecord, readers: TaskDoc[], targets: Set<string>, what: string) {
  const loose = readers.filter((t) => !reaches(e, t.id, targets));
  const names = [...targets].join(", ");
  return loose.length === 0
    ? pass(`${readers.map((t) => t.id).join(", ")} depend on ${names}`)
    : fail(`${loose.map(label).join("; ")} does not depend on the ${what} (${names})`);
}

export const migrationFirst = epicCheck(
  "migration-first",
  "outcome",
  "a schema migration task exists and every task about order status depends on it",
  (e) => {
    const m = new Set(e.tasks.filter((t) => MIGRATION.test(title(t))).map((t) => t.id));
    if (m.size === 0) return fail("no task title names a migration, schema or column change");
    const readers = e.tasks.filter((t) => !m.has(t.id) && /status/i.test(title(t)));
    if (readers.length === 0) return fail("no task title names order status");
    return dependsOnAll(e, readers, m, "migration");
  },
);

export const backfillBeforeReads = epicCheck(
  "backfill-before-reads",
  "outcome",
  "existing orders are backfilled, and every task that shows status depends on the backfill",
  (e) => {
    const b = new Set(
      e.tasks
        .filter(
          (t) =>
            /backfill/i.test(title(t)) || (MIGRATION.test(title(t)) && /backfill/i.test(t.body)),
        )
        .map((t) => t.id),
    );
    if (b.size === 0) return fail("no task backfills existing orders");
    const readers = e.tasks.filter(
      (t) => !b.has(t.id) && /status/i.test(title(t)) && READER.test(title(t)),
    );
    if (readers.length === 0) return fail("no task title shows status in the API, page or app");
    return dependsOnAll(e, readers, b, "backfill");
  },
);

export const consumerRepoNamed = epicCheck(
  "consumer-repo-named",
  "outcome",
  "the iOS client repository (shop-ios) is in the epic's repos or named by a task",
  (e) => {
    const repos = getList(e.epic?.frontmatter ?? {}, "repos");
    if (repos.some((r) => r.includes("shop-ios"))) return pass(`repos: ${repos.join(", ")}`);
    const t = e.tasks.find((t) => `${title(t)}\n${t.body}`.includes("shop-ios"));
    return t
      ? pass(`${t.id} names shop-ios`)
      : fail(`shop-ios is in neither repos (${repos.join(", ") || "none"}) nor any task`);
  },
);

export const totalChangeCompatible = epicCheck(
  "total-change-compatible",
  "outcome",
  "exact totals keep `total` readable by existing clients (new column, expand/contract, versioned API)",
  (e) => {
    const text = [e.epic?.body ?? "", e.plan?.body ?? "", ...e.tasks.map((t) => t.body)].join("\n");
    const m = text.match(COMPATIBLE);
    return m
      ? pass(`"${m[0]}"`)
      : fail("no compatible path for exact totals (new column, expand/contract, /v2)");
  },
);

export const blockerRecorded = epicCheck(
  "blocker-recorded",
  "outcome",
  "the ShipFast credential wait (OPS-112) is in the plan or a task, or the webhook task is blocked",
  (e) => {
    if ((e.plan?.body ?? "").includes("OPS-112")) return pass("OPS-112 in plan.md");
    const named = e.tasks.find((t) => `${title(t)}\n${t.body}`.includes("OPS-112"));
    if (named) return pass(`OPS-112 in ${named.id}`);
    const blocked = e.tasks.find(
      (t) =>
        getString(t.frontmatter, "status") === "blocked" &&
        /shipfast|webhook|carrier/i.test(`${title(t)}\n${t.body}`),
    );
    return blocked
      ? pass(`${blocked.id} is blocked`)
      : fail("OPS-112 is in neither plan.md nor a task, and no ShipFast task is blocked");
  },
);

export const acceptanceTestable = epicCheck(
  "acceptance-testable",
  "outcome",
  "no acceptance line or milestone exit criterion is vague (a vague word with no number or code)",
  (e) => {
    const lines: [string, string][] = [
      ...e.tasks.flatMap((t) =>
        (sectionBody(t.body, "Acceptance criteria") ?? "")
          .split("\n")
          .map((l): [string, string] => [t.id, l]),
      ),
      ...(sectionBody(e.plan?.body ?? "", "Milestones") ?? "")
        .split("\n")
        .map((l): [string, string] => ["plan.md", l]),
    ];
    const checked = lines.filter(([, l]) => CHECKBOX.test(l));
    const vague = checked.filter(([, l]) => VAGUE.test(l) && !/\d|`/.test(l));
    return vague.length === 0
      ? pass(`${checked.length} criteria, none vague`)
      : fail(vague.map(([where, l]) => `${where}: ${l.trim()}`).join("; "));
  },
);

function milestoneNumber(t: TaskDoc | undefined): number | null {
  const m = (t ? getString(t.frontmatter, "milestone") : undefined)?.match(/^M(\d+)$/);
  return m?.[1] ? Number(m[1]) : null;
}

export const depsFollowMilestones = epicCheck(
  "deps-follow-milestones",
  "outcome",
  "no task depends on a task in a later milestone",
  (e) => {
    const byId = new Map(e.tasks.map((t) => [t.id, t]));
    const bad: string[] = [];
    for (const t of e.tasks) {
      const own = milestoneNumber(t);
      for (const d of getList(t.frontmatter, "depends-on")) {
        const dep = milestoneNumber(byId.get(d));
        if (own !== null && dep !== null && dep > own)
          bad.push(`${t.id} (M${own}) -> ${d} (M${dep})`);
      }
    }
    return bad.length === 0 ? pass(`${e.tasks.length} tasks in order`) : fail(bad.join("; "));
  },
);

export function planningTrapChecks(): Check[] {
  return [
    migrationFirst,
    backfillBeforeReads,
    consumerRepoNamed,
    totalChangeCompatible,
    blockerRecorded,
    acceptanceTestable,
    depsFollowMilestones,
  ];
}
