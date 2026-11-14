import { TARGETS } from "../../ci/e2e/workspace";
import { getList, getString } from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import type { EpicRecord, TaskDoc } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { sameRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo-url";
import {
  BASE_IMAGE,
  FINDINGS,
  type FindingKey,
  finding,
  PARENTS,
  STOREFRONT_URL,
  WORKER_URL,
} from "../scenarios/security-fix-facts";
import { fail, pass, skip } from "./common";
import { asks, MANAGER_COMMANDS, ORDERS_URL, RELEASES, reaches, work } from "./multi-stack-repo";
import { epicCheck } from "./new-epic";
import type { Check, CheckResult } from "./types";

export type Target = "orders" | "webshop" | "storefront" | "worker" | "argocd";
const TARGET_NAMES: Target[] = ["orders", "webshop", "storefront", "worker", "argocd"];

const NAMES: Record<Target, RegExp> = {
  orders: /\borders\b/i,
  webshop: /\bwebshop\b/i,
  storefront: /\bstorefront\b/i,
  worker: /\bworker\b/i,
  argocd: /\bargo\s?cd\b/i,
};
/** Paths and packages that only one repo has; webshop has none of its own. */
const PATHS: Partial<Record<Target, RegExp>> = {
  orders:
    /\bdeploy\/chart\b|\bvalues\.ya?ml\b|\bimage\.tag\b|\bmake\s+release\b|\binternal\/orders\b|\bcmd\/orders\b/i,
  storefront:
    /\bpackage(?:-lock)?\.json\b|\bsrc\/(?:server|app)\.js\b|\bexpress\b|\bpath-to-regexp\b/i,
  worker: /\bpyproject\.toml\b|\buv\.lock\b|\buv\s+(?:lock|sync|add)\b/i,
  argocd: /\bworkloads\/|\bkustomization\.ya?ml\b|\bnewTag\b/i,
};

// "The same change as in orders" names orders without working there.
const CROSS_REF =
  /\b(?:the\s+)?same\s+(?:change|fix|bump|upgrade)\s+as\s+(?:in\s+|for\s+)?(?:orders|webshop|storefront)\b|\b(?:as|like)\s+(?:in|for)\s+(?:orders|webshop|storefront)\b/gi;

export function targetsOf(t: TaskDoc): Target[] {
  const text = work(t).replace(CROSS_REF, "");
  return TARGET_NAMES.filter((n) => NAMES[n].test(text) || (PATHS[n]?.test(text) ?? false));
}

const NPM = finding("npm");
const GO = finding("go");
const PY = finding("python");
const parentOf = (repo: string) => PARENTS.find((p) => p.repo === repo);

/** What a task must name to work on a finding; the image's FROM is case-sensitive, "from" is not. */
const COVERS: Record<"npm" | "go", RegExp> = {
  npm: /path-to-regexp|\bexpress\b/i,
  go: /golang\.org\/x\/net|\bx\/net\b|gorilla\/websocket|\bwebsocket\b/i,
};
const IMAGE_FROM = /\bFROM\b/;
const IMAGE_WORDS =
  /\bbase image\b|\bDockerfile\b|\bnode:\d|\balpine|\blibssl|\blibcrypto|\bopenssl|\bapk\b/i;

interface Fix {
  /** what the evidence calls it */
  name: string;
  service: "orders" | "webshop" | "storefront";
  key: FindingKey;
}
const FIXES: Fix[] = [
  { name: "storefront npm", service: "storefront", key: "npm" },
  { name: "storefront image", service: "storefront", key: "image" },
  { name: "orders Go", service: "orders", key: "go" },
  { name: "webshop Go", service: "webshop", key: "go" },
];

function covers(t: TaskDoc, fix: Fix): boolean {
  if (!targetsOf(t).includes(fix.service)) return false;
  const text = work(t);
  if (fix.key === "image") return IMAGE_FROM.test(text) || IMAGE_WORDS.test(text);
  return (fix.key === "npm" ? COVERS.npm : COVERS.go).test(text);
}

const bumps = (e: EpicRecord, fix: Fix) => e.tasks.filter((t) => covers(t, fix));

// Release actions as the orders grader reads them, plus a pushed or created tag, a named release,
// and cut or ship. "The release workflow" alone is a rollout naming what pushed its image.
const RELEASE = new RegExp(
  `${RELEASES.source}|\\bpush\\w*\\b[^\\n]*\\btag\\b|\\brelease\\s+(?:orders|webshop|storefront)\\b|\\b(?:cut|ship)\\s+(?:orders|webshop|storefront)\\b|\\bcreate\\s+(?:a\\s+)?\`?v?\\d+\\.\\d+(?:\\.\\d+)?\`?\\s+tag\\b`,
  "im",
);
/** What a rollout task must also do to count as its own release. */
const OWN_RELEASE =
  /\bmake\s+release\b|\btag\s+`?v?\d|\bcut\s+|\bbump\w*\s+`?VERSION\b|\bcreate\s+(?:a\s+)?`?v?\d[\w.]*`?\s+tag\b/i;
const ORDERS_ROLLOUT = /\bdeploy\/chart\b|\bvalues\.ya?ml\b|\bimage\.tag\b|\bhelm\s+upgrade\b/i;
const ARGO_ROLLOUT = /\bworkloads\/|\bnewTag\b|\bkustomization\b/i;

function isRollout(t: TaskDoc, service: Fix["service"]): boolean {
  if (!targetsOf(t).includes(service)) return false;
  const text = work(t);
  return service === "orders" ? ORDERS_ROLLOUT.test(text) : ARGO_ROLLOUT.test(text);
}

function releasesOf(e: EpicRecord, service: Fix["service"]): TaskDoc[] {
  return e.tasks.filter((t) => {
    if (!targetsOf(t).includes(service)) return false;
    const text = work(t);
    return RELEASE.test(text) && (!isRollout(t, service) || OWN_RELEASE.test(text));
  });
}

function rolloutsOf(e: EpicRecord, service: Fix["service"]): TaskDoc[] {
  return e.tasks.filter((t) => isRollout(t, service));
}

/** `t` is `target`, or depends on it directly or transitively. */
const waits = (e: EpicRecord, t: TaskDoc, target: TaskDoc) =>
  t.id === target.id || reaches(e, t.id, new Set([target.id]));

const hitReposCovered = epicCheck(
  "hit-repos-covered",
  "outcome",
  "every hit repo and image has a task: storefront's npm package and base image, orders, and the unnamed webshop",
  (e): CheckResult => {
    const missing = FIXES.filter((f) => bumps(e, f).length === 0).map((f) => f.name);
    return missing.length === 0
      ? pass("a task fixes each of the four")
      : fail(`no task fixes ${missing.join(", ")}`);
  },
);

const fixReachesDeploy = epicCheck(
  "fix-reaches-deploy",
  "outcome",
  "each fix runs bump, then release, then the rollout, with depends-on in that order",
  (e): CheckResult => {
    const judged = FIXES.filter((f) => bumps(e, f).length > 0);
    if (judged.length === 0) return skip("no fix task to follow");
    const misses: string[] = [];
    for (const f of judged) {
      const b = bumps(e, f);
      const releases = releasesOf(e, f.service);
      const rollouts = rolloutsOf(e, f.service);
      const ready = releases.filter((r) => {
        const before = b.filter((x) => x.id === r.id || !waits(e, x, r));
        return before.length > 0 && before.every((x) => waits(e, r, x));
      });
      const shipped = rollouts.some((d) => ready.some((r) => waits(e, d, r)));
      if (shipped) continue;
      if (rollouts.length === 0) misses.push(`${f.name}: no rollout task`);
      else if (releases.length === 0) misses.push(`${f.name}: no release task`);
      else if (ready.length === 0) misses.push(`${f.name}: the release does not wait for the fix`);
      else misses.push(`${f.name}: the rollout does not wait for the release`);
    }
    return misses.length === 0
      ? pass(`${judged.map((f) => f.name).join(", ")} each reach a rollout`)
      : fail(misses.join("; "));
  },
);

const LATEST = "latest";
const RULE = "rule";
const V = "`?(?:>=|≥)?\\s*[\\^~]?v?(\\d+\\.\\d+(?:\\.\\d+)?)`?";
const FROM_V =
  "(?:(?:dependency|package)\\s+)?(?:in\\s+\\S+\\s+)?(?:from\\s+`?v?\\d+\\.\\d+(?:\\.\\d+)?`?\\s+)?";
const ARROW = "(?:→|->|=>)";
/** Explicit targets right after the name; a version anywhere else on the line says nothing. */
const AT = new RegExp(`^@${V}`);
const TO_LATEST = new RegExp(`^\\s*${FROM_V}(?:to|${ARROW})\\s+(?:the\\s+)?latest\\b`, "i");
const TO_RULE = new RegExp(
  `^\\s*${FROM_V}to\\s+(?:(?:the|a|that|this)\\s+)?(?:(?:first|earliest|lowest|newest|any)\\b[^.\\n]*?\\b(?:release|version)\\b|(?:release|version)\\s+(?:that|which|whose)\\b|(?:release|version)\\b)`,
  "i",
);
const TO = new RegExp(`^\\s*${FROM_V}(?:to|${ARROW})\\s*${V}`, "i");
const FROM_ARROW = new RegExp(`^\\s*\`?v?\\d+\\.\\d+(?:\\.\\d+)?\`?\\s*${ARROW}\\s*${V}`);
const AT_LEAST = new RegExp(`^\\s*(?:>=|≥)\\s*${V}`);
const BARE = new RegExp(`^\\s+${V}`);
/** A command or a verb anywhere before an `@` target; word-exact, so "pins" or "requires" is not one. */
const COMMAND =
  /\b(?:go\s+get|npm\s+(?:i|install|add)|bun\s+add|yarn\s+add|pnpm\s+add|bump|upgrade|update|raise|move|pin|set|change|replace|install)\b/i;
/** A verb right before the name, for "upgrade golang.org/x/net v0.36.0". */
const VERB_BEFORE =
  /\b(?:bump|upgrade|update|raise|move|pin|set|change|replace|install|require)\s+`?$/i;
const GO_GET_BEFORE = /\bgo\s+get\s+(?:-\S+\s+)*`?$/i;
/** A package.json entry, `"express": "^4.21.2"`, right after the name's closing quote. */
const JSON_ENTRY = /^"\s*:\s*"[\^~]?v?(\d+\.\d+(?:\.\d+)?)"/;
const VERSION_CELL = /^`?[\^~]?v?(\d+\.\d+(?:\.\d+)?)`?$/;

/** In a table row naming `pkg`, the last of two or more version cells after it is the target. */
function tableTarget(line: string, pkg: string): string | null {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
  const at = cells.findIndex((c) => c.replace(/`/g, "").toLowerCase() === pkg.toLowerCase());
  if (at < 0) return null;
  const versions = cells.slice(at + 1).flatMap((c) => c.match(VERSION_CELL)?.[1] ?? []);
  return versions.length >= 2 ? (versions[versions.length - 1] ?? null) : null;
}

/** The version one mention of `pkg` chooses, or null when the mention only describes. */
function chosenAt(before: string, raw: string): string | null {
  const entry = raw.match(JSON_ENTRY);
  if (entry?.[1]) {
    // An entry inside an overrides block names the version the override sets.
    if (/\b(?:overrides|resolutions)\b/i.test(before)) return entry[1];
    // `change "express": "4.21.1" to "express": "^4.21.2"`: the first entry is where it starts.
    const startsChange = /^"[^"]*"[^"]*"\s+to\b/.test(raw);
    return /\bto\s+"$/i.test(before) ||
      (/\b(?:set|pin|bump|change|update)\s+"$/i.test(before) && !startsChange)
      ? entry[1]
      : null;
  }
  // The name's closing backtick or quote is not part of what follows it.
  const rest = raw.replace(/^[`'"]+/, "");
  if (/^@latest\b/i.test(rest)) return COMMAND.test(before) ? LATEST : null;
  const at = rest.match(AT);
  if (at?.[1]) return COMMAND.test(before) ? at[1] : null;
  if (TO_LATEST.test(rest)) return LATEST;
  if (TO_RULE.test(rest)) return RULE;
  const target = rest.match(TO) ?? rest.match(FROM_ARROW);
  if (target?.[1]) return target[1];
  // "`path-to-regexp` >=0.1.12 in storefront" is a condition to check unless something sets it.
  const floor = rest.match(AT_LEAST);
  if (floor?.[1]) return COMMAND.test(before) || VERB_BEFORE.test(before) ? floor[1] : null;
  const bare = rest.match(BARE);
  if (bare?.[1] && VERB_BEFORE.test(before)) return bare[1];
  // `go get <module>` with no version takes the latest.
  if (GO_GET_BEFORE.test(before)) return LATEST;
  return null;
}

/**
 * The versions a task chooses for `pkg`, one per mention that names a target: after `to`, an
 * arrow, `@` in a command, or `>=`; a version after `from` is a starting point, never a choice.
 */
export function chosenVersions(text: string, pkg: string): string[] {
  const out: string[] = [];
  const needle = pkg.toLowerCase();
  // A list item wrapped onto indented lines is one line.
  const joined = text.replace(/\n[ \t]+(?![-*|]|\d+\.)/g, " ");
  for (const line of joined.split("\n")) {
    if (line.trim().startsWith("|")) {
      const v = tableTarget(line, pkg);
      if (v !== null) out.push(v);
      continue;
    }
    const lower = line.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
      const rest = line.slice(at + pkg.length);
      // A longer name that starts with this one ("express-session") is another package.
      if (/^[\w-]/.test(rest)) continue;
      const v = chosenAt(line.slice(0, at), rest);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

const semver = (v: string) => {
  const parts = v.replace(/^v/, "").split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).join(".");
};
const atLeast = (v: string, floor: string) =>
  v === LATEST || Bun.semver.order(semver(v), semver(floor)) >= 0;
const below = (v: string, floor: string) =>
  v !== LATEST && v !== RULE && Bun.semver.order(semver(v), semver(floor)) < 0;

const HAND_EDIT =
  /\b(?:hand-?edit|edit|modify|patch)\w*\b[^.;\n]*\b(?:package-lock\.json|go\.sum|uv\.lock)\b/i;
const NEGATION = /\b(?:do not|don't|never|instead of|rather than|no need to|not)\b/i;
/** A sentence that tells someone to edit a lockfile by hand, not one that says not to. */
const handEdits = (text: string) =>
  text.split(/[.;\n]/).some((s) => HAND_EDIT.test(s) && !NEGATION.test(s));
const OVERRIDE = /\boverrides?\b|\bresolutions?\b/i;
const APK_UPGRADE =
  /\bapk\s+(?:upgrade|add\s+(?:--no-cache\s+)?(?:-u|--upgrade))\b|\bapt-get\s+(?:upgrade|install\s+--only-upgrade)\b/i;
const NEWER_BASE =
  /\b(?:newer|patched|latest|current|next|later)\b[^\n]*?\b(?:base|node|alpine)\b[^\n]*?\b(?:image|tag|minor|patch|release|line)\b|\b(?:newer|next|later)\s+(?:patch\s+|minor\s+)?(?:node|alpine|base|tag)\b/i;
const DIGEST = /@sha256:|\bdigest\b/i;
const IN_DOCKERFILE = /\bDockerfile\b|\bFROM\b/;
const NODE_TAG = /\bnode:[\w.-]*\w/g;

/** A node tag newer than the base: a later version, a later Alpine at the same one, or a floating tag. */
function newerTag(tag: string): boolean {
  if (tag === BASE_IMAGE.image) return false;
  const ver = (t: string) =>
    t
      .match(/^node:(\d+(?:\.\d+){0,2})/)?.[1]
      ?.split(".")
      .map(Number);
  const alpine = (t: string) =>
    t
      .match(/alpine(\d+)\.(\d+)/)
      ?.slice(1)
      .map(Number) ?? [];
  const mine = ver(tag);
  const base = ver(BASE_IMAGE.image) ?? [];
  if (!mine) return true;
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i] ?? 0;
    const b = base[i] ?? 0;
    if (a !== b) return a > b;
  }
  if (mine.length < 3) return true;
  const [ma = 0, mi = 0] = alpine(tag);
  const [ba = 0, bi = 0] = alpine(BASE_IMAGE.image);
  return ma > ba || (ma === ba && mi > bi);
}

/** Why one task's fix is right, wrong, or says nothing either way (null). */
function judge(t: TaskDoc, fix: Fix): "ok" | string | null {
  const text = asks(t);
  if (handEdits(text)) return "edits a lockfile by hand";
  if (fix.key === "image") {
    const newTag = [...text.matchAll(NODE_TAG)].some((m) => newerTag(m[0]));
    // A newer base counts only as a Dockerfile change; a rebuild with --pull keeps the frozen tag.
    const dockerfile = IN_DOCKERFILE.test(text);
    const flat = text.replace(/\n[ \t]+/g, " ");
    if (APK_UPGRADE.test(flat) || (dockerfile && (newTag || NEWER_BASE.test(flat)))) return "ok";
    return DIGEST.test(text) ? "pins a digest of the same image" : null;
  }
  const parent = parentOf(fix.service);
  if (!parent) return null;
  const f = fix.key === "npm" ? NPM : GO;
  const parentNames = fix.key === "npm" ? [parent.pkg] : [parent.pkg, "gorilla/websocket"];
  const pkgNames = fix.key === "npm" ? [f.pkg] : [f.pkg, "x/net"];
  const parentChoices = parentNames.flatMap((n) => chosenVersions(text, n));
  const pkgChoices = pkgNames.flatMap((n) => chosenVersions(text, n));
  const stale = [
    ...parentChoices.filter((v) => below(v, parent.firstFixing)).map((v) => `${parent.pkg} ${v}`),
    ...pkgChoices.filter((v) => below(v, f.fixed)).map((v) => `${f.pkg} ${v}`),
  ];
  if (stale.length > 0) return `chooses ${stale.join(", ")}, still affected`;
  const viaParent = parentChoices.some((v) => v === RULE || atLeast(v, parent.firstFixing));
  // Go's own fix writes the module into go.mod; npm needs an override to move a nested copy.
  const viaPkg =
    pkgChoices.some((v) => v !== RULE && atLeast(v, f.fixed)) &&
    (fix.key === "go" || OVERRIDE.test(text));
  if (viaParent || viaPkg) return "ok";
  return pkgChoices.length > 0 ? `bumps ${f.pkg} itself, which leaves the parent's copy` : null;
}

const rightBump = epicCheck(
  "right-bump",
  "outcome",
  "each fix goes through the package manager's own mechanism to a version at or above the fixed one",
  (e): CheckResult => {
    const judged = FIXES.filter((f) => bumps(e, f).length > 0);
    if (judged.length === 0) return skip("no fix task to judge");
    const misses: string[] = [];
    for (const f of judged) {
      const verdicts = bumps(e, f).map((t) => ({ id: t.id, v: judge(t, f) }));
      const wrong = verdicts.filter((x) => x.v !== null && x.v !== "ok");
      if (wrong.length > 0) {
        misses.push(`${f.name}: ${wrong.map((x) => `${x.id} ${x.v}`).join(", ")}`);
      } else if (!verdicts.some((x) => x.v === "ok")) {
        misses.push(
          `${f.name}: no task names a fix that reaches ${f.key === "image" ? BASE_IMAGE.fixed : finding(f.key).fixed}`,
        );
      }
    }
    return misses.length === 0
      ? pass(`${judged.map((f) => f.name).join(", ")} bump the right thing`)
      : fail(misses.join("; "));
  },
);

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const SAFE =
  /\bnot (?:affected|impacted|exposed|vulnerable)\b|\bunaffected\b|\bfalse positive\b|\bno (?:action|fix|update|upgrade|bump|change)s? (?:is )?(?:needed|required)\b|\bnothing to (?:do|fix|change)\b|\bis safe\b|\b(?:does not|doesn't) need (?:a |any )?(?:change|fix|update|upgrade|bump)\b|\bneeds no (?:change|fix|update|upgrade|bump)\b|\balready (?:fixed|patched)\b/i;
/** A line naming a check to run ("a re-scan reports it not affected"), not a claim. */
/** "Either already patched, or fixed", "whether it is affected": a question, not a claim. */
const CONDITIONAL = /\b(?:either|whether|if)\b|\bor\s+(?:confirm\w*|fixed|not)\b/i;

/** A paragraph's list items, each with its wrapped lines; a prose paragraph is one item. */
function items(paragraph: string): string[] {
  const out: string[] = [];
  for (const line of paragraph.split("\n")) {
    const last = out.length - 1;
    if (last < 0 || /^\s*(?:[-*]|\d+\.)\s/.test(line)) out.push(line);
    else out[last] = `${out[last]} ${line.trim()}`;
  }
  return out;
}

const OUTCOME =
  /\bre-?scan\b|\b(?:scan(?:ner)?|govulncheck|trivy|grype|osv-scanner|pip-audit|npm\s+audit)\b[^\n]*?\b(?:reports?|shows?|finds?|lists?)\b/i;
/** The worker's range admits affected versions, so only its lockfile proves it. */
const LOCK_EVIDENCE = /\buv\.lock\b|\block ?file\b/i;
const EVIDENCE =
  /\buv\.lock\b|\bgo\.(?:sum|mod)\b|\bpackage(?:-lock)?\.json\b|\bpyproject\.toml\b|\block ?file\b/i;
const SUBJECT = new RegExp(
  [
    "\\b(?:orders|webshop|storefront|worker)\\b",
    ...FINDINGS.flatMap((f) => [f.pkg, f.advisory, f.cve]).map(literal),
  ].join("|"),
  "i",
);

const WORKER = new RegExp(
  ["\\bworker\\b", PY.pkg, PY.advisory, PY.cve].map((x, i) => (i === 0 ? x : literal(x))).join("|"),
  "i",
);

function documents(e: EpicRecord): { name: string; text: string }[] {
  return [
    { name: "epic.md", text: e.epic?.body ?? "" },
    { name: "plan.md", text: e.plan?.body ?? "" },
    ...e.tasks.map((t) => ({
      name: t.id,
      text: `${getString(t.frontmatter, "title") ?? ""}\n\n${t.body}`,
    })),
  ];
}

const noUnprovenSafe = epicCheck(
  "no-unproven-safe",
  "outcome",
  "every not-affected or no-change claim cites its lockfile or file, and the flagged worker is addressed",
  (e): CheckResult => {
    // A claim is one list item or prose paragraph; its citation may sit anywhere in the paragraph.
    const claims = documents(e).flatMap((d) =>
      d.text.split(/\n\s*\n/).flatMap((p) =>
        items(p)
          .filter((i) => !OUTCOME.test(i))
          .map((i) => i.replace(/"[^"\n]*"/g, ""))
          .filter((i) => SAFE.test(i) && SUBJECT.test(i) && !CONDITIONAL.test(i))
          .map((i) => ({ doc: d.name, item: i, p, worker: WORKER.test(i) })),
      ),
    );
    const uncited = claims
      .filter((c) => !(c.worker ? LOCK_EVIDENCE : EVIDENCE).test(c.p))
      .map((c) => `${c.doc}: "${c.item.trim().slice(0, 80)}"`);
    // Addressed means a claim about the worker or a task in it, not its name in a list.
    const addressed =
      claims.some((c) => c.worker) || e.tasks.some((t) => targetsOf(t).includes("worker"));
    const misses = [
      ...(addressed ? [] : ["the flagged worker is left out without a word"]),
      ...uncited.map((u) => `uncited claim ${u}`),
    ];
    return misses.length === 0
      ? pass("every safe claim cites its evidence")
      : fail(misses.join("; "));
  },
);

const reposRegistered = epicCheck(
  "repos-registered",
  "outcome",
  "the epic's repos name orders and storefront, and every other repo a task changes",
  (e): CheckResult => {
    const repos = getList(e.epic?.frontmatter ?? {}, "repos");
    // A hit repo no task changes is hit-repos-covered's failure, not this one's. A repo named in
    // passing ("Argo CD picks up the image", "the webshop dashboard") is not changed: argocd
    // changes with a rollout, webshop with a fix of its own.
    const webshopFix = FIXES.find((f) => f.service === "webshop");
    const changed = (n: Target): boolean => {
      if (n === "argocd") {
        return rolloutsOf(e, "storefront").length + rolloutsOf(e, "webshop").length > 0;
      }
      if (n === "webshop") return webshopFix ? bumps(e, webshopFix).length > 0 : false;
      return e.tasks.some((t) => targetsOf(t).includes(n));
    };
    const optional: [Target, string][] = [
      ["webshop", TARGETS.webshop],
      ["argocd", TARGETS.argocd],
      ["worker", WORKER_URL],
    ];
    const need: [string, string][] = [
      ["orders", ORDERS_URL],
      ["storefront", STOREFRONT_URL],
      ...optional.filter(([n]) => changed(n)),
    ];
    const missing = need.filter(([, url]) => !repos.some((r) => sameRepo(r, url))).map(([n]) => n);
    return missing.length === 0
      ? pass(`repos names ${need.map(([n]) => n).join(", ")}`)
      : fail(`repos ${repos.join(", ") || "(none)"} lack ${missing.join(", ")}`);
  },
);

const noManagerCommands = epicCheck(
  "no-manager-commands",
  "outcome",
  "no task names the manager's bun commands",
  (e): CheckResult => {
    const leaked = e.tasks.filter((t) => MANAGER_COMMANDS.test(asks(t)));
    return leaked.length === 0
      ? pass("no task names a manager command")
      : fail(`${leaked.map((t) => t.id).join(", ")} name the manager's bun commands`);
  },
);

const NETWORK =
  /\bcurl\b|\bwget\b|\bgh\s+(?:api|search)\b|\bnpm\s+(?:view|info|show|audit|outdated|install|i|ci|update|add)\b|\bbun\s+(?:install|i|add|update)\b|\bgo\s+get\b|\bgo\s+mod\s+(?:download|tidy)\b|\bgo\s+list\s+-m\b[^\n]*\s-(?:u|versions)\b|\bpip3?\s+(?:install|download|index)\b|\buv\s+(?:add|lock|sync|pip\s+install)\b|\bdocker\s+(?:pull|run|manifest|build|buildx)\b|\bgovulncheck\b|\btrivy\b|\bgrype\b|\bosv-scanner\b|\bpip-audit\b|\bsnyk\b/;
const EXPLAIN =
  /\bnpm\s+(?:explain|ls|why)\b|\bbun\s+why\b|\bgo\s+mod\s+(?:why|graph)\b|\buv\s+tree\b|\bpip3?\s+show\b/;

/** The command before any heredoc body: a body is text written to a file, not a command run. */
const runPart = (c: string) => c.split(/<<-?\s*['"]?\w+['"]?/)[0] ?? c;

/** Recorded, never scored: what the run tried online, and how it traced dependencies. */
const dependencyCommands: Check = {
  id: "dependency-commands",
  kind: "diagnostic",
  description: "network attempts (none expected) and dependency-explain commands the run used",
  async run(ctx) {
    const commands = ctx.telemetry.commands ?? [];
    const calls = ctx.telemetry.toolCalls ?? {};
    const network = commands.filter((c) => NETWORK.test(runPart(c)));
    const web = ["WebFetch", "WebSearch"]
      .filter((n) => (calls[n] ?? 0) > 0)
      .map((n) => `${n} x${calls[n]}`);
    const explain = commands.filter((c) => EXPLAIN.test(runPart(c)));
    const evidence = [
      `network: ${network.join(" | ") || "none"}`,
      `web tools: ${web.join(", ") || "none"}`,
      `explain: ${explain.join(" | ") || "none"}`,
    ].join("; ");
    return network.length === 0 && web.length === 0 ? pass(evidence) : fail(evidence);
  },
};

export function securityFixChecks(): Check[] {
  return [
    hitReposCovered,
    fixReachesDeploy,
    rightBump,
    noUnprovenSafe,
    reposRegistered,
    noManagerCommands,
    dependencyCommands,
  ];
}
