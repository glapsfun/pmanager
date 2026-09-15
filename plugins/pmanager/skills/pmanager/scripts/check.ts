import {
  contractVersion,
  EPIC_REQUIRED_FIELDS,
  EPIC_REQUIRED_SECTIONS,
  EPIC_STATUSES,
  EPIC_TYPES,
  EPIC_V1_FIELDS,
  ESTIMATES,
  getList,
  getString,
  hasSection,
  type ParsedDoc,
  PLAN_REQUIRED_FIELDS,
  PLAN_REQUIRED_SECTIONS,
  PLAN_STATUSES,
  PRIORITIES,
  sectionBody,
  sessionOf,
  splitFrontmatter,
  TASK_REQUIRED_FIELDS,
  TASK_REQUIRED_SECTIONS,
  TASK_STATUSES,
  TASK_V1_FIELDS,
} from "./contract";
import type { Finding } from "./findings";
import {
  LOG_END,
  LOG_START,
  type MarkerState,
  markerState,
  planRender,
  TASKS_END,
  TASKS_START,
} from "./render";
import { type EpicRecord, epicId, type PmRepo } from "./repo";

export interface CheckOptions {
  staleDays: number;
  today: string;
}

type Rule = (repo: PmRepo, opts: CheckOptions) => Finding[];

function err(file: string, rule: string, message: string, fix: string): Finding {
  return { file, rule, severity: "error", message, fix };
}

function warn(file: string, rule: string, message: string, fix: string): Finding {
  return { file, rule, severity: "warning", message, fix };
}

function frontmatterBroken(doc: ParsedDoc): boolean {
  const parts = splitFrontmatter(doc.raw);
  return parts !== null && parts.yaml.trim() !== "" && Object.keys(doc.frontmatter).length === 0;
}

type Vocab = Record<string, readonly string[]>;

function checkFields(doc: ParsedDoc, required: string[], vocab: Vocab): Finding[] {
  const out: Finding[] = [];
  for (const f of required) {
    if (doc.frontmatter[f] === undefined) {
      out.push(
        err(
          doc.path,
          "E-STR-003",
          `missing frontmatter field "${f}"`,
          `add "${f}:" to the frontmatter`,
        ),
      );
    }
  }
  for (const [field, allowed] of Object.entries(vocab)) {
    const v = getString(doc.frontmatter, field);
    if (v !== undefined && !allowed.includes(v)) {
      out.push(
        err(
          doc.path,
          "E-STR-004",
          `"${field}: ${v}" is not one of ${allowed.join(" | ")}`,
          `use one of: ${allowed.join(", ")}`,
        ),
      );
    }
  }
  return out;
}

function checkSections(doc: ParsedDoc, required: string[]): Finding[] {
  return required
    .filter((s) => !hasSection(doc.body, s))
    .map((s) =>
      err(doc.path, "E-STR-002", `missing required section "## ${s}"`, `add a "## ${s}" section`),
    );
}

type DocSpec = [ParsedDoc | null, string[], Vocab, string[]];

export const structureRules: Rule = (repo) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    if (!e.epic) {
      out.push(
        err(
          `${e.dir}/epic.md`,
          "E-STR-001",
          "epic.md is missing",
          "create it from references/epic.template.md",
        ),
      );
    }
    if (!e.plan) {
      out.push(
        err(
          `${e.dir}/plan.md`,
          "E-STR-001",
          "plan.md is missing",
          "create it from references/plan.template.md",
        ),
      );
    }
    const docs: DocSpec[] = [
      [
        e.epic,
        EPIC_REQUIRED_FIELDS,
        { status: EPIC_STATUSES, type: EPIC_TYPES },
        EPIC_REQUIRED_SECTIONS,
      ],
      [e.plan, PLAN_REQUIRED_FIELDS, { status: PLAN_STATUSES }, PLAN_REQUIRED_SECTIONS],
      ...e.tasks.map(
        (t): DocSpec => [
          t,
          TASK_REQUIRED_FIELDS,
          { status: TASK_STATUSES, priority: PRIORITIES, estimate: ESTIMATES },
          TASK_REQUIRED_SECTIONS,
        ],
      ),
    ];
    for (const [doc, fields, vocab, sections] of docs) {
      if (!doc) continue;
      if (frontmatterBroken(doc)) {
        out.push(
          err(
            doc.path,
            "E-STR-005",
            "frontmatter could not be parsed",
            "fix the YAML between the --- fences",
          ),
        );
        continue;
      }
      out.push(...checkFields(doc, fields, vocab), ...checkSections(doc, sections));
    }
  }
  return out;
};

export const identityRules: Rule = (repo) => {
  const out: Finding[] = [];
  const seen = new Map<string, string>();
  for (const e of repo.epics) {
    if (!e.epic) continue;
    const id = epicId(e);
    const prev = seen.get(id);
    if (prev) {
      out.push(
        err(
          e.epic.path,
          "E-ID-001",
          `epic id "${id}" already used by ${prev}`,
          "give one of the epics a different id",
        ),
      );
    } else seen.set(id, e.epic.path);
    const ids = new Set<string>();
    for (const t of e.tasks) {
      if (ids.has(t.id)) {
        out.push(
          err(t.path, "E-ID-002", `task id "${t.id}" duplicated in ${e.slug}`, "renumber the task"),
        );
      }
      ids.add(t.id);
      const prefix = t.path.split("/").pop()?.split("-")[0];
      if (prefix !== t.id) {
        out.push(
          err(
            t.path,
            "E-ID-003",
            `task id "${t.id}" does not match filename prefix "${prefix}"`,
            "rename the file or the id",
          ),
        );
      }
    }
  }
  return out;
};

function milestonesOf(plan: ParsedDoc | null): Set<string> {
  const set = new Set<string>();
  if (!plan) return set;
  for (const m of plan.body.matchAll(/^### (M\d+)\b/gm)) if (m[1]) set.add(m[1]);
  return set;
}

function findCycle(epic: EpicRecord): string[] | null {
  const deps = new Map(epic.tasks.map((t) => [t.id, getList(t.frontmatter, "depends-on")]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 1) return [...stack.slice(stack.indexOf(id)), id];
    if (s === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const t of epic.tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return null;
}

export const referenceRules: Rule = (repo) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    const milestones = milestonesOf(e.plan);
    const ids = new Set(e.tasks.map((t) => t.id));
    for (const t of e.tasks) {
      const ep = getString(t.frontmatter, "epic");
      if (ep !== undefined && ep !== e.slug) {
        out.push(
          err(
            t.path,
            "E-REF-001",
            `task epic "${ep}" differs from directory "${e.slug}"`,
            `set "epic: ${e.slug}"`,
          ),
        );
      }
      const ms = getString(t.frontmatter, "milestone");
      if (ms !== undefined && e.plan && !milestones.has(ms)) {
        out.push(
          err(
            t.path,
            "E-REF-002",
            `milestone "${ms}" not found in plan.md`,
            `add "### ${ms} — …" to the plan or fix the id`,
          ),
        );
      }
      for (const d of getList(t.frontmatter, "depends-on")) {
        if (!ids.has(d)) {
          out.push(
            err(
              t.path,
              "E-REF-003",
              `depends-on "${d}" is not a task of ${e.slug}`,
              "fix the task id",
            ),
          );
        }
      }
    }
    const cycle = findCycle(e);
    if (cycle) {
      out.push(
        err(
          `${e.dir}/tasks`,
          "E-REF-004",
          `dependency cycle ${cycle.join(" -> ")}`,
          "remove one dependency from the cycle",
        ),
      );
    }
  }
  return out;
};

const MARKER_PROBLEM: Record<Exclude<MarkerState, "ok">, string> = {
  missing: "has no",
  unterminated: "has an unterminated",
  misordered: "has a misordered",
  duplicate: "has a duplicate",
};

export const derivedViewRules: Rule = (repo) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    if (!e.plan || contractVersion(e.plan.frontmatter) < 1) continue;
    const state = markerState(e.plan.raw, TASKS_START, TASKS_END);
    if (state !== "ok") {
      out.push(
        err(
          e.plan.path,
          "E-RND-004",
          `plan is contract 1 but ${MARKER_PROBLEM[state]} pm:tasks marker pair`,
          "run render --migrate, or put exactly one start/end marker pair around the task table",
        ),
      );
    }
  }
  const anyV1 = repo.epics.some((e) => e.epic && contractVersion(e.epic.frontmatter) >= 1);
  if (repo.memo && anyV1) {
    const state = markerState(repo.memo.raw, LOG_START, LOG_END);
    if (state !== "ok") {
      out.push(
        err(
          repo.memo.path,
          "E-RND-004",
          `memo ${MARKER_PROBLEM[state]} pm:log marker pair`,
          "run render --migrate, or put exactly one start/end marker pair in the Changelog section",
        ),
      );
    }
  }
  for (const f of planRender(repo)) {
    if (f.path.endsWith("INDEX.md")) {
      out.push(
        err(
          f.path,
          "E-RND-001",
          f.before === null ? "INDEX.md is missing" : "INDEX.md is stale",
          "run render",
        ),
      );
    } else if (f.path.endsWith("plan.md")) {
      out.push(err(f.path, "E-RND-002", "task table is stale", "run render"));
    } else {
      out.push(err(f.path, "E-RND-003", "memo changelog is stale", "run render"));
    }
  }
  return out;
};

export function isStale(updated: string, today: string, staleDays: number): boolean {
  const u = Date.parse(`${updated}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(u) || Number.isNaN(t)) return false;
  return (t - u) / 86_400_000 > staleDays;
}

function nonEmpty(s: string | null): boolean {
  return s !== null && s.trim() !== "";
}

export const stateRules: Rule = (repo) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    const wont =
      sectionBody(e.plan?.body ?? "", "Prioritization")
        ?.split("\n")
        .find((l) => l.trim().startsWith("- Won't")) ?? "";
    for (const t of e.tasks) {
      const status = getString(t.frontmatter, "status");
      if (status === "blocked" && !nonEmpty(sectionBody(t.body, "Notes"))) {
        out.push(
          err(
            t.path,
            "E-ST-001",
            "blocked task does not name its blocker",
            "add a line under ## Notes naming the blocker",
          ),
        );
      }
      if (status === "descoped" && !wont.includes(t.id)) {
        out.push(
          err(
            t.path,
            "E-ST-002",
            `descoped task ${t.id} is not listed in the plan's Won't line`,
            `add "${t.id} … (reason)" to "- Won't (this epic):" in plan.md`,
          ),
        );
      }
      if (status === "done") {
        const ac = sectionBody(t.body, "Acceptance criteria") ?? "";
        if (/^- \[ \]/m.test(ac) && !ac.includes("**unverified**")) {
          out.push(
            err(
              t.path,
              "E-ST-003",
              "done task has unchecked acceptance criteria",
              "check every criterion, or add **unverified** under ## Acceptance criteria",
            ),
          );
        }
      }
    }
    if (e.epic && getString(e.epic.frontmatter, "status") === "done") {
      const milestones = sectionBody(e.plan?.body ?? "", "Milestones") ?? "";
      const unchecked = /^- \[ \]/m.test(milestones);
      const outcome = nonEmpty(sectionBody(e.epic.body, "Outcome"));
      if (unchecked || !outcome) {
        const why = unchecked
          ? "a milestone exit criterion is unchecked"
          : "## Outcome is missing or empty";
        out.push(
          err(
            e.epic.path,
            "E-ST-004",
            `epic is done but ${why}`,
            "check all milestone exit criteria and record the validation outcome under ## Outcome",
          ),
        );
      }
    }
  }
  return out;
};

export const claimRules: Rule = (repo, opts) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    if (!e.epic) continue;
    const fm = e.epic.frontmatter;
    const session = sessionOf(fm);
    if (session) {
      if (session.harness === "" || session.claimed === "" || session.branch !== `pm/${e.slug}`) {
        out.push(
          err(
            e.epic.path,
            "E-CLM-001",
            `session block malformed (expected harness, claimed, branch: pm/${e.slug})`,
            "fix the session block or re-run claim",
          ),
        );
      } else if (isStale(getString(fm, "updated") ?? "", opts.today, opts.staleDays)) {
        out.push(
          warn(
            e.epic.path,
            "W-CLM-001",
            `claim by ${session.harness} is stale (updated ${getString(fm, "updated")}, > ${opts.staleDays} days)`,
            "release it, or claim --takeover",
          ),
        );
      }
    } else if (getString(fm, "status") === "in-progress") {
      out.push(
        warn(
          e.epic.path,
          "W-CLM-002",
          "epic is in-progress but no session owns it",
          "run claim <slug>",
        ),
      );
    }
  }
  return out;
};

export const legacyRules: Rule = (repo) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    const docs: Array<[ParsedDoc | null, string[]]> = [
      [e.epic, EPIC_V1_FIELDS],
      ...e.tasks.map((t): [ParsedDoc, string[]] => [t, TASK_V1_FIELDS]),
    ];
    for (const [doc, fields] of docs) {
      if (!doc || contractVersion(doc.frontmatter) !== 0) continue;
      for (const f of fields) {
        if (doc.frontmatter[f] === undefined) {
          out.push(
            warn(doc.path, "W-LEG-001", `contract-0 document lacks "${f}"`, "run render --migrate"),
          );
        }
      }
    }
  }
  return out;
};

export const RULES = [
  "E-STR-001",
  "E-STR-002",
  "E-STR-003",
  "E-STR-004",
  "E-STR-005",
  "E-ID-001",
  "E-ID-002",
  "E-ID-003",
  "E-REF-001",
  "E-REF-002",
  "E-REF-003",
  "E-REF-004",
  "E-RND-001",
  "E-RND-002",
  "E-RND-003",
  "E-RND-004",
  "E-ST-001",
  "E-ST-002",
  "E-ST-003",
  "E-ST-004",
  "E-CLM-001",
  "W-CLM-001",
  "W-CLM-002",
  "W-LEG-001",
] as const;

const rules: Rule[] = [
  structureRules,
  identityRules,
  referenceRules,
  derivedViewRules,
  stateRules,
  claimRules,
  legacyRules,
];

export function check(repo: PmRepo, opts: CheckOptions): Finding[] {
  const out: Finding[] = [];
  for (const r of rules) out.push(...r(repo, opts));
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule);
  });
}
