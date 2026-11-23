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
  parseHistory,
  sectionBody,
  sessionOf,
  splitFrontmatter,
  TASK_REQUIRED_FIELDS,
  TASK_REQUIRED_SECTIONS,
  TASK_STATUSES,
  TASK_V1_FIELDS,
} from "./contract";
import { bumpTargets, type Carrier, carriersAcross, compareVersions, matchesPackage } from "./deps";
import type { Finding } from "./findings";
import type { ImageRelease } from "./images";
import {
  type Command,
  type CrossLink,
  crossLinks,
  namesCommand,
  namesVerbatim,
  type Profile,
  partId,
  resolvePart,
} from "./profile";
import { type Catalog, renderProjectsIndex, sameRepo } from "./projects";
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
  /** stored profiles by project id; the part and release-link rules read them */
  profiles?: Map<string, Profile>;
  /**
   * For E-DEP-001: by package a task of the epic under work bumps (lowercased), the registered
   * repos checked out here that carry it. Absent when the epic bumps nothing.
   */
  carriers?: Map<string, Carrier[]>;
  staleDays: number;
  today: string;
  /** the main checkout's project catalog; absent or empty means no catalog rules */
  catalog?: Catalog;
  /**
   * main: the catalog's own files are checked too; epic: only W-PRJ-001, so a bad
   * catalog file in the main checkout never blocks an epic branch's check or record.
   */
  catalogScope?: "main" | "epic";
  /**
   * The epic being recorded or checked with --epic. Rules about the plan under work run
   * only for it, so plain check never fails a plan already in use.
   */
  epic?: string;
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

/** Milestone ids in the order plan.md lists them. */
export function milestoneOrder(plan: ParsedDoc | null): string[] {
  if (!plan) return [];
  return [...plan.body.matchAll(/^### (M\d+)\b/gm)].flatMap((m) => (m[1] ? [m[1]] : []));
}

function milestonesOf(plan: ParsedDoc | null): Set<string> {
  return new Set(milestoneOrder(plan));
}

const STARTED = new Set(["in-progress", "done"]);

/** In progress or done now, or once: a task blocked after work began has the move in its History. */
function started(t: EpicRecord["tasks"][number]): boolean {
  if (STARTED.has(getString(t.frontmatter, "status") ?? "")) return true;
  return (
    parseHistory(t.body)?.entries.some((h) => h.kind === "status" && STARTED.has(h.to)) ?? false
  );
}

/**
 * E-REF-005: a first-milestone task nothing depends on. In the #16 bench runs this is how
 * a plan that states "nothing works without T01" still let pm status offer later work first.
 * Only while the plan has not started, so tracking updates on running epics are never blocked.
 * A task with a `standalone:` reason feeds no task by design.
 */
export const planGraphRules: Rule = (repo, opts) => {
  const e = repo.epics.find((x) => x.slug === opts.epic);
  if (!e) return [];
  const status = (t: (typeof e.tasks)[number]) => getString(t.frontmatter, "status") ?? "";
  if (e.tasks.some(started)) return [];
  const [first, ...later] = milestoneOrder(e.plan);
  const live = e.tasks.filter((t) => status(t) !== "descoped");
  // Headings with no tasks yet are an unfinished plan, not a prerequisite nothing uses.
  if (!first || !live.some((t) => later.includes(getString(t.frontmatter, "milestone") ?? ""))) {
    return [];
  }
  const needed = new Set(live.flatMap((t) => getList(t.frontmatter, "depends-on")));
  return live
    .filter(
      (t) =>
        getString(t.frontmatter, "milestone") === first &&
        !needed.has(t.id) &&
        !getString(t.frontmatter, "standalone")?.trim(),
    )
    .map((t) =>
      err(
        t.path,
        "E-REF-005",
        `${t.id} (${first}) is a prerequisite of nothing: no task depends on it`,
        `add ${t.id} to depends-on of each task that needs its result; if no task does, move it to the milestone whose state it serves; only if it serves none, give it standalone: <why no task needs it>`,
      ),
    );
};

/** Title, work, criteria and notes: where a task names the commands it runs. */
function taskText(t: EpicRecord["tasks"][number]): string {
  return [
    getString(t.frontmatter, "title") ?? "",
    sectionBody(t.body, "What to do") ?? "",
    sectionBody(t.body, "Acceptance criteria") ?? "",
    sectionBody(t.body, "Notes") ?? "",
  ].join("\n");
}

function reachesAny(e: EpicRecord, from: string, targets: Set<string>): boolean {
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

interface EpicProfiles {
  profiles: Map<string, Profile>;
  /** The epic's own repos; a rollout repo in profiles must still be listed in repos:. */
  listed: Set<string>;
  cross: CrossLink[];
}

/**
 * What the part, release and break rules read for the epic under work: null while they are off
 * (another epic, a started one, or no stored profile for its repos).
 */
function epicProfiles(e: EpicRecord | undefined, opts: CheckOptions): EpicProfiles | null {
  if (!e?.epic || !opts.profiles || !opts.catalog || e.tasks.some(started)) return null;
  const repos = getList(e.epic.frontmatter, "repos");
  const profiles = new Map<string, Profile>();
  for (const project of opts.catalog.projects) {
    const p = opts.profiles.get(project.id);
    // A repo pm found nothing in asks nothing of its tasks.
    const empty = !p || (p.parts.length === 0 && p.shared.length === 0);
    if (p && !empty && repos.some((u) => sameRepo(u, project.url))) profiles.set(project.id, p);
  }
  if (profiles.size === 0) return null;
  // A release of the epic's repos that ships through another repo makes that repo's parts usable,
  // whether or not repos: names it: the rollout task lives there.
  const listed = new Set(profiles.keys());
  const cross = crossLinks(opts.profiles).filter((c) => profiles.has(c.project));
  for (const c of cross) {
    for (const r of c.rollouts) {
      const q = opts.profiles.get(r.project);
      if (q) profiles.set(r.project, q);
    }
  }
  return { profiles, listed, cross };
}

/**
 * E-PRT-001..003 and E-REL-001..002: for the epic under work, while unstarted, and only when its
 * repos have stored profiles. In #16's multi-stack run planners never named the chart's CI checks
 * and 9 of 10 never moved the chart's image tag after the release.
 */
export const partRules: Rule = (repo, opts) => {
  const e = repo.epics.find((x) => x.slug === opts.epic);
  const ctx = epicProfiles(e, opts);
  if (!e?.epic || !opts.catalog || !ctx) return [];
  const { profiles, listed, cross } = ctx;
  // The parts a tag-triggered release covers: a task that only pushes the tag is that release.
  const tagReleased = new Set(
    cross
      .filter((c) => c.release.trigger.kind === "tag")
      .map((c) => partId(c.project, c.release.folder)),
  );
  const live = e.tasks.filter((t) => getString(t.frontmatter, "status") !== "descoped");
  // The ids a planner can use, capped: a hint repeated per task must stay short.
  const allIds = [...profiles].flatMap(([id, p]) => [
    ...(!p.parts.some((x) => x.folder === "") && p.shared.length > 0 ? [`${id} (whole repo)`] : []),
    ...p.parts.map((x) => partId(id, x.folder)),
  ]);
  const known =
    allIds.length > 10
      ? `${allIds.slice(0, 10).join(", ")}, ${allIds.length - 10} more (pm research --repo <id> lists them)`
      : allIds.join(", ");
  const quote = (cs: Command[]) => cs.map((c) => `\`${c.text}\` (${c.source})`).join(", ");
  const out: Finding[] = [];
  const named = new Map<string, string[]>();
  const partKey = (hit: { project: string; part: { folder: string } }) =>
    `${hit.project}\0${hit.part.folder}`;
  // The tasks that name each part's checks: a release task after one of them needs no test.
  const checkedBy = new Map<string, Set<string>>();
  for (const t of live) {
    for (const id of "parts" in t.frontmatter ? getList(t.frontmatter, "parts") : []) {
      const hit = resolvePart(id, profiles);
      if (!hit?.part.commands.some((c) => c.role === "check" && namesCommand(taskText(t), c)))
        continue;
      const k = partKey(hit);
      checkedBy.set(k, (checkedBy.get(k) ?? new Set()).add(t.id));
    }
  }
  for (const t of live) {
    if (!("parts" in t.frontmatter)) {
      out.push(
        err(
          t.path,
          "E-PRT-001",
          `${t.id} does not say which parts it changes`,
          `add parts: [...] with ids from pm research (${known}), or parts: [] when it changes none`,
        ),
      );
      continue;
    }
    const ids = getList(t.frontmatter, "parts");
    named.set(t.id, ids);
    const text = taskText(t);
    for (const id of ids) {
      const hit = resolvePart(id, profiles);
      if (!hit) {
        out.push(
          err(
            t.path,
            "E-PRT-002",
            `${t.id} names ${id}, which no stored profile has`,
            `use one of ${known}`,
          ),
        );
        continue;
      }
      if (!listed.has(hit.project)) {
        const url = opts.catalog.projects.find((x) => x.id === hit.project)?.url ?? hit.project;
        out.push(
          err(
            t.path,
            "E-PRT-002",
            `${t.id} names ${id}, in ${hit.project}, which the epic's repos: does not list`,
            `add ${url} to repos: in epic.md`,
          ),
        );
        continue;
      }
      const checks = hit.part.commands.filter((c) => c.role === "check");
      // A release task that runs the release as written, after the part's checked work, is checked
      // by that release: asking it for a test cost a round. A task that changes code still is not.
      const releases =
        (hit.part.commands.some((c) => c.role === "release" && namesVerbatim(text, c)) ||
          (tagReleased.has(partId(hit.project, hit.part.folder)) && TAG_PUSH.test(text))) &&
        reachesAny(e, t.id, checkedBy.get(partKey(hit)) ?? new Set());
      if (checks.length > 0 && !releases && !checks.some((c) => namesCommand(text, c))) {
        out.push(
          err(
            t.path,
            "E-PRT-003",
            `${t.id} changes ${id} but names none of its checks`,
            `name one of ${quote(checks)} in What to do or Acceptance criteria`,
          ),
        );
      }
    }
  }
  if (getString(e.epic.frontmatter, "no-release")?.trim()) return out;
  for (const [project, p] of profiles) {
    for (const link of p.links.filter((l) => l.release)) {
      const source = partId(project, link.source.folder);
      const consumer = partId(project, link.consumer.folder);
      const changed = live.filter((t) => named.get(t.id)?.includes(source));
      const release =
        p.parts
          .find((x) => x.folder === link.source.folder)
          ?.commands.filter((c) => c.role === "release") ?? [];
      if (changed.length === 0 || release.length === 0) continue;
      const releasers = new Set(
        live.filter((t) => release.some((c) => namesCommand(taskText(t), c))).map((t) => t.id),
      );
      if (releasers.size === 0) {
        out.push(
          err(
            e.epic.path,
            "E-REL-001",
            `${changed.map((t) => t.id).join(", ")} change ${source}, and no task releases it`,
            `add a task that runs ${quote(release)} after those changes, or set no-release: <why> on the epic when it ships no release`,
          ),
        );
      }
      const movers = live.filter(
        (t) => named.get(t.id)?.includes(consumer) && taskText(t).includes(link.consumer.key),
      );
      if (!movers.some((t) => releasers.has(t.id) || reachesAny(e, t.id, releasers))) {
        out.push(
          err(
            e.epic.path,
            "E-REL-002",
            `no task naming ${consumer} moves ${link.consumer.key} after ${source}'s release`,
            `add a task with parts: [${consumer}] that sets ${link.consumer.key} in ${link.consumer.file} to the released version and depends on the release task`,
          ),
        );
      }
    }
  }
  out.push(...crossReleaseFindings(e.epic.path, e, live, named, cross));
  return out;
};

/** A task that pushes a release tag: `git tag v1.2.3`, "push a v1.2.3 tag", "tag v1.2.3". */
// A version holds dots, so the words may be a short span apart, not a sentence apart.
const TAG_PUSH =
  /\bgit\s+tag\b|\bpush\w*\b[^\n]{0,40}?\btags?\b|\btag\s+`?v?\d|\bcreate\w*\b[^\n]{0,40}?\btag\b|\bcut\b[^\n]{0,30}?\b(?:tag|release)\b/i;

// Research's own wording, quoted into a task: "... pushes ghcr.io/x/y on a v* tag".
const QUOTED_RELEASE = /\bpushes\s+\S+(?:,\s*\S+)*\s+on\s+a\s+\S+\s+tag\b/gi;

/**
 * Whether the text pushes a tag the trigger matches: a version like v1.2.3, the pattern as
 * research writes it ("push a `v*` tag"), or a new version or release tag. Line breaks are spaces.
 */
function pushesMatchingTag(r: ImageRelease, text: string): boolean {
  const flat = text.replace(/\s+/g, " ");
  if (r.trigger.kind !== "tag") return flat.includes(r.trigger.pattern);
  const clean = flat.replace(QUOTED_RELEASE, "");
  if (!TAG_PUSH.test(clean)) return false;
  const prefix = r.trigger.pattern.split("*")[0] ?? "";
  const literal = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    !prefix ||
    new RegExp(`\\b${literal(prefix)}\\d`).test(clean) ||
    clean.includes(r.trigger.pattern) ||
    /\b(?:new\s+)?(?:version|release)\s+tag\b/i.test(clean)
  );
}

/**
 * E-REL-001 and E-REL-002 for a release whose rollout is in another registered repo (#17): in
 * the security-fix run 9 of 10 plans fixed storefront and never shipped it.
 */
function crossReleaseFindings(
  epicPath: string,
  e: EpicRecord,
  live: EpicRecord["tasks"],
  named: Map<string, string[]>,
  cross: ReturnType<typeof crossLinks>,
): Finding[] {
  const out: Finding[] = [];
  for (const c of cross) {
    if (!c.release.image || c.rollouts.length === 0) continue;
    const source = partId(c.project, c.release.folder);
    const changed = live.filter((t) => named.get(t.id)?.includes(source));
    if (changed.length === 0) continue;
    const { kind, pattern } = c.release.trigger;
    const places = c.rollouts.map((r) => ({
      id: partId(r.project, r.folder),
      key: r.key,
      file: r.file,
    }));
    // A release task: in the releasing repo (or naming no part), after every change it ships,
    // and pushing a tag the trigger matches. It may also roll out, as one task.
    const isRelease = (t: EpicRecord["tasks"][number]) => {
      const ids = named.get(t.id) ?? [];
      if (ids.length > 0 && !ids.includes(source)) return false;
      if (!changed.every((x) => x.id === t.id || reachesAny(e, t.id, new Set([x.id]))))
        return false;
      return pushesMatchingTag(c.release, taskText(t));
    };
    // A branch-triggered release ships on merge: the change tasks are the release.
    const releasers = new Set(
      kind === "branch" ? changed.map((t) => t.id) : live.filter(isRelease).map((t) => t.id),
    );
    if (releasers.size === 0) {
      const how = kind === "tag" ? `pushes a ${pattern} tag` : `runs ${pattern}`;
      out.push(
        err(
          epicPath,
          "E-REL-001",
          `${changed.map((t) => t.id).join(", ")} change ${source}, and no task releases it`,
          `add a task that ${how} after those changes, or set no-release: <why> on the epic when it ships no release`,
        ),
      );
    }
    const movers = live.filter((t) =>
      places.some((x) => named.get(t.id)?.includes(x.id) && taskText(t).includes(x.key)),
    );
    if (!movers.some((t) => releasers.has(t.id) || reachesAny(e, t.id, releasers))) {
      const first = places[0] as (typeof places)[number];
      const after = kind === "branch" ? `the tasks that change ${source}` : "the release task";
      out.push(
        err(
          epicPath,
          "E-REL-002",
          `no task naming ${places.map((x) => x.id).join(" or ")} moves ${first.key} after ${source}'s release`,
          `add a task with parts: [${first.id}] that sets ${first.key} in ${first.file} and depends on ${after}`,
        ),
      );
    }
  }
  return out;
}

/** A task that can stand in for a consumer's rollout, and how a finding names it. */
interface Rollout {
  id: string;
  says: string;
}

/**
 * E-BRK-001..002: a task whose breaks: names another registered repo waits, through depends-on,
 * for that repo's change to roll out. In cross-repo-links-cold 3 of 10 plans removed a field
 * webshop still read before webshop's rollout, and pm check passed all three.
 */
export const breakRules: Rule = (repo, opts) => {
  const e = repo.epics.find((x) => x.slug === opts.epic);
  const ctx = epicProfiles(e, opts);
  if (!e?.epic || !opts.catalog || !opts.profiles || !ctx) return [];
  const { profiles, listed, cross } = ctx;
  const noRelease = Boolean(getString(e.epic.frontmatter, "no-release")?.trim());
  const live = e.tasks.filter((t) => getString(t.frontmatter, "status") !== "descoped");
  const known = [...listed].sort().join(", ");
  const projectOf = (id: string) => resolvePart(id, profiles)?.project;
  const reach = (from: string, to: string) => from === to || reachesAny(e, from, new Set([to]));
  const byId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const out: Finding[] = [];
  for (const b of live) {
    const own = new Set(getList(b.frontmatter, "parts").flatMap((id) => projectOf(id) ?? []));
    for (const x of new Set(getList(b.frontmatter, "breaks"))) {
      const project = opts.catalog.projects.find((p) => p.id === x);
      const stored = opts.profiles.get(x);
      if (!project || !stored || (stored.parts.length === 0 && stored.shared.length === 0)) {
        out.push(
          err(
            b.path,
            "E-BRK-002",
            `${b.id} breaks ${x}, which is not a registered project with a stored profile`,
            `use one of ${known}`,
          ),
        );
        continue;
      }
      if (!listed.has(x)) {
        out.push(
          err(
            b.path,
            "E-BRK-002",
            `${b.id} breaks ${x}, which the epic's repos: does not list`,
            `add ${project.url} to repos: in epic.md`,
          ),
        );
        continue;
      }
      if (own.has(x)) {
        out.push(
          err(
            b.path,
            "E-BRK-002",
            `${b.id} breaks ${x}, its own repo`,
            `order work inside ${x} with depends-on; breaks: names other repos`,
          ),
        );
        continue;
      }
      // X's deploy config in the folders that roll out its image is X's too.
      const rolloutParts = new Set(
        cross
          .filter((c) => c.project === x)
          .flatMap((c) => c.rollouts.map((r) => partId(r.project, r.folder))),
      );
      const partsIn = (t: EpicRecord["tasks"][number]) =>
        getList(t.frontmatter, "parts").filter((id) => projectOf(id) === x || rolloutParts.has(id));
      // A task that depends on the break comes after it, such as a cleanup: never required.
      const before = live.filter(
        (t) => t.id !== b.id && partsIn(t).length > 0 && !reachesAny(e, t.id, new Set([b.id])),
      );
      if (before.length === 0) {
        out.push(
          err(
            b.path,
            "E-BRK-001",
            `${b.id} breaks ${x}, and no task changes ${x} before it`,
            `add a task with parts: in ${x} that moves it off what ${b.id} changes, and add it to ${b.id}'s depends-on; if ${x} reads it through config another repo holds, name that repo in breaks: instead`,
          ),
        );
        continue;
      }
      const owed = new Map<string, string>();
      let unrolled = false;
      for (const part of [...new Set(before.flatMap(partsIn))]) {
        const naming = before.filter((t) => partsIn(t).includes(part));
        const releases = noRelease ? [] : breakReleases(e, live, x, part, naming, profiles, cross);
        if (releases.length === 0) {
          for (const t of naming) if (!reach(b.id, t.id) && !owed.has(t.id)) owed.set(t.id, t.id);
          continue;
        }
        for (const rollouts of releases) {
          if (rollouts.length === 0) unrolled = true;
          else if (!rollouts.some((r) => reach(b.id, r.id))) {
            const first = [...rollouts].sort((p, q) => byId(p.id, q.id))[0] as Rollout;
            owed.set(first.id, first.says);
          }
        }
      }
      if (unrolled) {
        out.push(
          err(
            b.path,
            "E-BRK-001",
            `${b.id} breaks ${x}, and ${x}'s change has no rollout task after its release yet`,
            `add the release and rollout tasks E-REL-001 and E-REL-002 name, then add the rollout task to ${b.id}'s depends-on`,
          ),
        );
      } else if (owed.size > 0) {
        const owedIds = [...owed.keys()].sort(byId);
        out.push(
          err(
            b.path,
            "E-BRK-001",
            `${b.id} breaks ${x} and does not wait for ${owedIds.map((id) => owed.get(id)).join(", ")}`,
            `add ${owedIds.join(", ")} to ${b.id}'s depends-on`,
          ),
        );
      }
    }
  }
  return out;
};

/**
 * For each release of part `part` of project `x` that rolls out somewhere, the tasks that roll it
 * out after a release of the changes made before the break (`naming`). An empty list is a release
 * with no such rollout yet; no entries means the part ships through no release.
 */
function breakReleases(
  e: EpicRecord,
  live: EpicRecord["tasks"],
  x: string,
  part: string,
  naming: EpicRecord["tasks"],
  profiles: Map<string, Profile>,
  cross: CrossLink[],
): Rollout[][] {
  const reach = (from: string, to: string) => from === to || reachesAny(e, from, new Set([to]));
  const afterChanges = (t: EpicRecord["tasks"][number]) => naming.every((n) => reach(t.id, n.id));
  const partsOf = (t: EpicRecord["tasks"][number]) => getList(t.frontmatter, "parts");
  const rolledAfter = (
    releasers: EpicRecord["tasks"],
    places: { id: string; key: string }[],
  ): Rollout[] =>
    live.flatMap((t) => {
      const place = places.find((p) => partsOf(t).includes(p.id) && taskText(t).includes(p.key));
      if (!place || !releasers.some((r) => reach(t.id, r.id))) return [];
      return [{ id: t.id, says: `its rollout (${t.id} sets ${place.key} in ${place.id})` }];
    });
  const out: Rollout[][] = [];
  for (const c of cross) {
    if (c.project !== x || c.rollouts.length === 0 || partId(x, c.release.folder) !== part)
      continue;
    const releasers =
      c.release.trigger.kind === "branch"
        ? naming
        : live.filter((t) => {
            const ids = partsOf(t);
            if (ids.length > 0 && !ids.includes(part)) return false;
            return afterChanges(t) && pushesMatchingTag(c.release, taskText(t));
          });
    const places = c.rollouts.map((r) => ({ id: partId(r.project, r.folder), key: r.key }));
    out.push(rolledAfter(releasers, places));
  }
  const p = profiles.get(x);
  for (const link of p?.links.filter((l) => l.release) ?? []) {
    if (partId(x, link.source.folder) !== part) continue;
    const commands =
      p?.parts
        .find((q) => q.folder === link.source.folder)
        ?.commands.filter((c) => c.role === "release") ?? [];
    if (commands.length === 0) continue;
    const releasers = live.filter(
      (t) => afterChanges(t) && commands.some((c) => namesCommand(taskText(t), c)),
    );
    const places = [{ id: partId(x, link.consumer.folder), key: link.consumer.key }];
    out.push(rolledAfter(releasers, places));
  }
  return out;
}

/**
 * E-DEP-001: a task bumps a package, and another registered repo still carries an older version
 * that no task of the epic changes. In the security-fix run every plan missed webshop.
 */
export const depRules: Rule = (repo, opts) => {
  const e = repo.epics.find((x) => x.slug === opts.epic);
  if (!e?.epic || !opts.carriers || opts.carriers.size === 0 || e.tasks.some(started)) return [];
  const live = e.tasks.filter((t) => getString(t.frontmatter, "status") !== "descoped");
  // "webshop: not deployed" skips webshop; a reason that only cites the scan proves nothing.
  const reasons = new Map(
    getList(e.epic.frontmatter, "dep-skip").map((x) => {
      const at = x.indexOf(":");
      return [(at < 0 ? x : x.slice(0, at)).trim(), at < 0 ? "" : x.slice(at + 1).trim()] as const;
    }),
  );
  const proven = (why: string) => !SCAN_ONLY.test(why) || EVIDENCE_WORDS.test(why);
  const parts = live.flatMap((t) => getList(t.frontmatter, "parts"));
  const covered = (project: string) =>
    parts.some((id) => id === project || id.startsWith(`${project}/`));
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const t of live) {
    for (const b of bumpTargets(taskText(t))) {
      for (const c of opts.carriers.get(b.name.toLowerCase()) ?? []) {
        const older = compareVersions(c.ecosystem, c.version, b.version);
        if (older === null || older >= 0 || covered(c.project)) continue;
        const why = reasons.get(c.project);
        if (why !== undefined && proven(why)) continue;
        const k = `${c.project}\0${c.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(
          err(
            e.epic.path,
            "E-DEP-001",
            why !== undefined
              ? `${c.project} also carries ${c.name} ${c.version} (${c.file}:${c.line}); its dep-skip reason cites only the scan, and a scan not naming a repo is no proof it is unaffected`
              : `${c.project} also carries ${c.name} ${c.version} (${c.file}:${c.line}); no task in this epic changes it`,
            `add a task with parts in ${c.project} that moves it to ${b.version}, or, when it truly is not affected, add it to the epic as\ndep-skip:\n  - "${c.project}: <why it is not affected>"`,
          ),
        );
      }
    }
  }
  return out;
};

// A dep-skip reason that only says the scan or ticket did not name the repo.
const SCAN_ONLY = /\b(?:scan\w*|ticket|report\w*|flag\w*|named|listed|mention\w*)\b/i;
// What would show a repo unaffected: not deployed, not built, never imports it, already fixed.
const EVIDENCE_WORDS =
  /\b(?:deploy\w*|retired|archived|unused|not used|never imports?|imports? no|not built|replace[ds]?|already|pinned|lockfile|go\.mod)\b/i;

/**
 * What E-DEP-001 reads: for each package a task of the epic under work bumps, the registered repos
 * checked out here that carry it. Undefined when the epic bumps nothing, so no checkout is read.
 */
export async function epicCarriers(
  root: string,
  catalog: Catalog,
  repo: PmRepo,
  epic: string | undefined,
): Promise<Map<string, Carrier[]> | undefined> {
  const e = repo.epics.find((x) => x.slug === epic);
  if (!e) return undefined;
  const names = [
    ...new Set(e.tasks.flatMap((t) => bumpTargets(taskText(t)).map((b) => b.name.toLowerCase()))),
  ];
  if (names.length === 0) return undefined;
  const r = await carriersAcross(root, catalog, names);
  return new Map(names.map((n) => [n, r.carriers.filter((c) => matchesPackage(n, c))]));
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

const VAGUE =
  /\b(nice|nicer|better|smooth(er|ly)?|intuitive|user-friendly|polish(ed)?|feels?|properly|as expected|looks? good|modern)\b/i;

/** Unchecked checkbox items of a section, each joined with its indented continuation lines. */
function openCriteria(body: string, section: string): string[] {
  const items: string[] = [];
  let open = false;
  for (const l of (sectionBody(body, section) ?? "").split("\n")) {
    const item = l.match(/^\s*- \[ \] (.*)$/);
    if (item) {
      items.push((item[1] ?? "").trim());
      open = true;
    } else if (open && /^\s+\S/.test(l) && !/^\s*[-*] /.test(l)) {
      items[items.length - 1] += ` ${l.trim()}`;
    } else open = false;
  }
  return items;
}

export const acceptanceRules: Rule = (repo) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    const docs: Array<[ParsedDoc | null, string]> = [
      [e.plan, "Milestones"],
      ...e.tasks.map((t): [ParsedDoc, string] => [t, "Acceptance criteria"]),
    ];
    for (const [doc, section] of docs) {
      if (!doc) continue;
      for (const c of openCriteria(doc.body, section)) {
        if (VAGUE.test(c) && !/\d|`/.test(c)) {
          out.push(
            warn(
              doc.path,
              "W-ACC-001",
              `criterion "${c}" has no number or command to decide it`,
              "rewrite it with a number, a command, or a result anyone can observe",
            ),
          );
        }
      }
    }
  }
  return out;
};

const KNOWN_TASK_STATUSES: readonly string[] = TASK_STATUSES;

export const historyRules: Rule = (repo, opts) => {
  const out: Finding[] = [];
  for (const e of repo.epics) {
    for (const t of e.tasks) {
      const history = parseHistory(t.body);
      if (!history) continue;
      for (const line of history.invalid) {
        out.push(
          err(
            t.path,
            "E-HIS-001",
            `History line in neither form: "${line}"`,
            'use "- YYYY-MM-DD status <from> -> <to>[; fixed by <what>]" or "- YYYY-MM-DD attempt failed: tried <what>; got <result>; evidence <path>"',
          ),
        );
      }
      // An invalid line may be the missing status line, and an unknown status is E-STR-003/004's
      // to report; either way the suggested line would itself be wrong.
      const status = getString(t.frontmatter, "status") ?? "";
      if (history.invalid.length > 0 || !KNOWN_TASK_STATUSES.includes(status)) continue;
      const last = history.entries.filter((h) => h.kind === "status").at(-1);
      if (last && last.to !== status) {
        out.push(
          warn(
            t.path,
            "W-HIS-002",
            `last History status is "${last.to}" but frontmatter status is "${status}"`,
            `append "- ${opts.today} status ${last.to} -> ${status}" or correct the frontmatter`,
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

const FINISHED = new Set(["done", "abandoned"]);

export const catalogRules: Rule = (repo, opts) => {
  const catalog = opts.catalog;
  if (!catalog) return [];
  const out: Finding[] = [];
  const main = (opts.catalogScope ?? "main") === "main";
  for (const bad of main ? catalog.invalid : []) {
    out.push(err(bad.file, "E-PRJ-001", bad.reason, "fix the project file's frontmatter"));
  }
  (main ? catalog.projects : []).forEach((p, i) => {
    const twin = catalog.projects.slice(0, i).find((q) => sameRepo(q.url, p.url));
    if (twin) {
      out.push(
        err(
          p.file,
          "E-PRJ-001",
          `same repository as project ${twin.id}`,
          "remove one of the two files",
        ),
      );
    }
  });
  if (catalog.projects.length === 0) return out;
  // A catalog added to a manager with history must not flag every finished epic on each record.
  for (const e of repo.epics) {
    if (!e.epic || FINISHED.has(getString(e.epic.frontmatter, "status") ?? "")) continue;
    for (const url of getList(e.epic.frontmatter, "repos")) {
      if (catalog.projects.some((p) => sameRepo(p.url, url))) continue;
      out.push(
        warn(
          e.epic.path,
          "W-PRJ-001",
          `${url} is not a registered project`,
          `pm project add ${url}`,
        ),
      );
    }
  }
  if (main && catalog.index !== renderProjectsIndex(catalog.projects)) {
    const index =
      catalog.projects[0]?.file.replace(/[^/]+$/, "INDEX.md") ?? "docs/pm/projects/INDEX.md";
    out.push(
      warn(index, "W-PRJ-002", "the projects index is stale", "run pm render in the main checkout"),
    );
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
  "E-REF-005",
  "E-PRT-001",
  "E-PRT-002",
  "E-PRT-003",
  "E-REL-001",
  "E-REL-002",
  "E-BRK-001",
  "E-BRK-002",
  "E-DEP-001",
  "E-RND-001",
  "E-RND-002",
  "E-RND-003",
  "E-RND-004",
  "E-ST-001",
  "E-ST-002",
  "E-ST-003",
  "E-ST-004",
  "W-ACC-001",
  "E-HIS-001",
  "W-HIS-002",
  "E-CLM-001",
  "W-CLM-001",
  "W-CLM-002",
  "W-LEG-001",
  "E-PRJ-001",
  "W-PRJ-001",
  "W-PRJ-002",
] as const;

const rules: Rule[] = [
  structureRules,
  identityRules,
  referenceRules,
  planGraphRules,
  partRules,
  breakRules,
  depRules,
  derivedViewRules,
  stateRules,
  acceptanceRules,
  historyRules,
  claimRules,
  legacyRules,
  catalogRules,
];

export function check(repo: PmRepo, opts: CheckOptions): Finding[] {
  const out: Finding[] = [];
  for (const r of rules) out.push(...r(repo, opts));
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule);
  });
}
