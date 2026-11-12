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

export function targetsOf(t: TaskDoc): Target[] {
  const text = work(t);
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

// Release actions as the orders grader reads them, plus a pushed tag and a named release.
const RELEASE = new RegExp(
  `${RELEASES.source}|\\bpush\\w*\\b[^\\n]*\\btag\\b|\\brelease\\s+(?:orders|webshop|storefront)\\b|\\brelease workflow\\b`,
  "im",
);
const ORDERS_ROLLOUT = /\bdeploy\/chart\b|\bvalues\.ya?ml\b|\bimage\.tag\b|\bhelm\s+upgrade\b/i;
const ARGO_ROLLOUT = /\bworkloads\/|\bnewTag\b|\bkustomization\b/i;

function releasesOf(e: EpicRecord, service: Fix["service"]): TaskDoc[] {
  return e.tasks.filter((t) => targetsOf(t).includes(service) && RELEASE.test(work(t)));
}

function rolloutsOf(e: EpicRecord, service: Fix["service"]): TaskDoc[] {
  return e.tasks.filter((t) => {
    const at = targetsOf(t);
    if (!at.includes(service)) return false;
    const text = work(t);
    return service === "orders" ? ORDERS_ROLLOUT.test(text) : ARGO_ROLLOUT.test(text);
  });
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
      const ready = releases.filter((r) => b.every((x) => waits(e, r, x)));
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
const VERSION_AT = /`?v?(\d+\.\d+(?:\.\d+)?)/;
const ACTION =
  /\b(?:bump|upgrade|update|move|raise|set|pin|install|require|go\s+get|switch|use)\w*\b/i;
const BY_RULE =
  /^\W*(?:to\s+)?(?:the\s+)?(?:first|latest|newest|earliest|lowest|any|a)\b[^.\n]*?\b(?:release|version)\b/i;

/**
 * The versions a task chooses for `pkg`, on lines that act on it: the one after `to`, `@` or
 * `>=`, else the first one after the name, never the one after `from` (a starting point).
 */
export function chosenVersions(text: string, pkg: string): string[] {
  const out: string[] = [];
  const needle = pkg.toLowerCase();
  for (const line of text.split("\n")) {
    const at = line.toLowerCase().indexOf(needle);
    if (at < 0 || !ACTION.test(line.slice(0, at))) continue;
    const rest = line.slice(at + pkg.length);
    if (/^@latest\b|^\W*(?:to\s+)?(?:the\s+)?latest\b/i.test(rest)) {
      out.push(LATEST);
      continue;
    }
    if (BY_RULE.test(rest)) {
      out.push(RULE);
      continue;
    }
    const after = rest.match(new RegExp(`(?:\\bto\\s+|@|>=\\s*)${VERSION_AT.source}`));
    if (after?.[1]) {
      out.push(after[1]);
      continue;
    }
    const loose = rest.replace(new RegExp(`\\bfrom\\s+${VERSION_AT.source}`, "g"), "");
    const first = loose.match(VERSION_AT);
    if (first?.[1]) out.push(first[1]);
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
  /\b(?:hand-?edit|edit|modify|patch|change)\w*\b[^.\n]*\b(?:package-lock\.json|go\.sum|uv\.lock)\b/i;
const OVERRIDE = /\boverrides?\b|\bresolutions?\b/i;
const APK_UPGRADE =
  /\bapk\s+(?:upgrade|add\s+(?:--no-cache\s+)?(?:-u|--upgrade))\b|\bapt-get\s+(?:upgrade|install\s+--only-upgrade)\b/i;
const NEWER_BASE =
  /\b(?:newer|patched|latest|current)\b[^.\n]*\b(?:base|node|alpine)\b[^.\n]*\b(?:image|tag)\b/i;
const DIGEST = /@sha256:|\bdigest\b/i;

/** Why one task's fix is right, wrong, or says nothing either way (null). */
function judge(t: TaskDoc, fix: Fix): "ok" | string | null {
  const text = asks(t);
  if (HAND_EDIT.test(text)) return "edits a lockfile by hand";
  if (fix.key === "image") {
    const tags = [...text.matchAll(/\bnode:[\w.-]+/g)].map((m) => m[0]);
    const newTag = tags.some((tag) => tag !== BASE_IMAGE.image);
    if (newTag || APK_UPGRADE.test(text) || NEWER_BASE.test(text)) return "ok";
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
  /\bnot affected\b|\bunaffected\b|\bnot vulnerable\b|\bno change (?:is )?(?:needed|required)\b|\balready (?:fixed|patched)\b/i;
const EVIDENCE =
  /\buv\.lock\b|\bgo\.(?:sum|mod)\b|\bpackage(?:-lock)?\.json\b|\bpyproject\.toml\b|\block ?file\b/i;
const SUBJECT = new RegExp(
  [
    "\\b(?:orders|webshop|storefront|worker)\\b",
    ...FINDINGS.flatMap((f) => [f.pkg, f.advisory, f.cve]).map(literal),
  ].join("|"),
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
    const docs = documents(e);
    const uncited = docs.flatMap((d) =>
      d.text
        .split(/\n\s*\n/)
        .filter((p) => SAFE.test(p) && SUBJECT.test(p) && !EVIDENCE.test(p))
        .map((p) => `${d.name}: "${p.trim().slice(0, 80)}"`),
    );
    const addressed = docs.some(
      (d) => /\bworker\b/i.test(d.text) || d.text.includes(PY.advisory) || d.text.includes(PY.cve),
    );
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
  "the epic's repos name orders, webshop and storefront, and argocd when a task changes it",
  (e): CheckResult => {
    const repos = getList(e.epic?.frontmatter ?? {}, "repos");
    const argo = e.tasks.some((t) => targetsOf(t).includes("argocd"));
    const need: [string, string][] = [
      ["orders", ORDERS_URL],
      ["webshop", TARGETS.webshop],
      ["storefront", STOREFRONT_URL],
      ...(argo ? ([["argocd", TARGETS.argocd]] as [string, string][]) : []),
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
  /\bcurl\b|\bwget\b|\bgh\s+(?:api|search)\b|\bnpm\s+(?:view|info|show|audit|outdated)\b|\bgo\s+get\b|\bgo\s+mod\s+download\b|\bgo\s+list\s+-m\b[^\n]*\s-u\b|\bpip3?\s+(?:download|index)\b|\buv\s+(?:add|lock|sync|pip\s+install)\b/;
const EXPLAIN =
  /\bnpm\s+(?:explain|ls|why)\b|\bbun\s+why\b|\bgo\s+mod\s+(?:why|graph)\b|\buv\s+tree\b|\bpip3?\s+show\b/;

/** Recorded, never scored: what the run tried online, and how it traced dependencies. */
const dependencyCommands: Check = {
  id: "dependency-commands",
  kind: "diagnostic",
  description: "network attempts (none expected) and dependency-explain commands the run used",
  async run(ctx) {
    const commands = ctx.telemetry.commands ?? [];
    const calls = ctx.telemetry.toolCalls ?? {};
    const network = commands.filter((c) => NETWORK.test(c));
    const web = ["WebFetch", "WebSearch"]
      .filter((n) => (calls[n] ?? 0) > 0)
      .map((n) => `${n} x${calls[n]}`);
    const explain = commands.filter((c) => EXPLAIN.test(c));
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
