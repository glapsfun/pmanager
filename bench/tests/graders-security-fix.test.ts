import { describe, expect, test } from "bun:test";
import { TARGETS } from "../../ci/e2e/workspace";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY, type Telemetry } from "../adapters/types";
import { headSha } from "../fixture";
import { buildCheckContext } from "../graders/context";
import { ORDERS_URL } from "../graders/multi-stack-repo";
import { securityFixChecks } from "../graders/security-fix";
import { runChecks } from "../graders/types";
import { BASE_IMAGE, finding, PARENTS, STOREFRONT_URL } from "../scenarios/security-fix-facts";

interface T {
  id: string;
  title: string;
  deps?: string[];
  what: string;
  accept?: string;
}

const SLUG = "security-fixes";
const NPM = finding("npm");
const GO = finding("go");
const PY = finding("python");
const EXPRESS = PARENTS.find((p) => p.finding === "npm") ?? PARENTS[0];
const REPOS = [ORDERS_URL, TARGETS.webshop, STOREFRONT_URL, TARGETS.argocd];
const CITED = `## Scope\n\nThe worker is not affected: uv.lock pins ${PY.pkg} 2.34.2, above ${PY.fixed}.\n`;

function taskFile(t: T): string {
  return `---
id: ${t.id}
epic: ${SLUG}
milestone: M1
title: ${t.title}
status: todo
priority: must
depends-on: [${(t.deps ?? []).join(", ")}]
parts: []
estimate: S
owner: unassigned
updated: 2026-11-12
contract: 1
---

# ${t.id} ${t.title}

## Context

Part of the security fixes.

## What to do

${t.what}

## Acceptance criteria

- [ ] ${t.accept ?? "done"}

## Out of scope

none

## Notes
`;
}

async function grade(
  tasks: T[],
  opts: { repos?: string[]; epicBody?: string; telemetry?: Telemetry } = {},
) {
  const dir = await makeTempDir("sec-plan");
  await initGitRepo(dir);
  const base = await headSha(dir);
  const repos = opts.repos ?? REPOS;
  const files: Record<string, string> = {
    [`docs/pm/${SLUG}/epic.md`]: `---\nid: ${SLUG}\ntitle: Security fixes\ntype: feature\nstatus: draft\ncreated: 2026-11-12\nupdated: 2026-11-12\ncontract: 1\nrepos:\n${repos.map((u) => `  - ${u}`).join("\n")}\n---\n\n# Security fixes\n\n${opts.epicBody ?? CITED}`,
    [`docs/pm/${SLUG}/plan.md`]: `---\nepic: ${SLUG}\nstatus: draft\nupdated: 2026-11-12\ncontract: 1\n---\n\n# Plan\n\n## Milestones\n\n### M1: Fixed and shipped\n`,
  };
  for (const t of tasks) files[`docs/pm/${SLUG}/tasks/${t.id}-x.md`] = taskFile(t);
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "plan"], dir);
  const info = {
    baselineSha: base,
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [],
    initialDirty: {},
  };
  const ctx = await buildCheckContext(dir, info, opts.telemetry ?? EMPTY_TELEMETRY);
  const res = await runChecks(securityFixChecks(), ctx);
  return {
    passed: Object.fromEntries(res.map((r) => [r.id, r.passed])),
    evidence: Object.fromEntries(res.map((r) => [r.id, r.evidence])),
  };
}

const T01: T = {
  id: "T01",
  title: "Upgrade express in storefront",
  what: `In storefront, bump express from ${EXPRESS.current} to ${EXPRESS.firstFixing} in package.json and run npm install, so ${NPM.pkg} resolves to ${NPM.fixed}.`,
  accept: "`npm test` passes",
};
const T02: T = {
  id: "T02",
  title: "Move storefront to a patched base image",
  what: `In storefront's Dockerfile, change FROM ${BASE_IMAGE.image} to node:20.19.5-alpine3.21 (to be confirmed: it ships ${BASE_IMAGE.osPackage} ${BASE_IMAGE.fixed} or later).`,
};
const T03: T = {
  id: "T03",
  title: "Release storefront 2.3.1",
  deps: ["T01", "T02"],
  what: "Tag v2.3.1 in storefront; the release workflow pushes ghcr.io/pm-example/storefront:2.3.1.",
};
const T04: T = {
  id: "T04",
  title: "Roll storefront 2.3.1 out",
  deps: ["T03"],
  what: "In argocd, set newTag: 2.3.1 in workloads/storefront/kustomization.yaml.",
};
const T05: T = {
  id: "T05",
  title: "Upgrade x/net in orders",
  what: `In orders, run go get ${GO.pkg}@v${GO.fixed} and go mod tidy.`,
  accept: "`make test` passes",
};
const T06: T = {
  id: "T06",
  title: "Release orders 1.4.1",
  deps: ["T05"],
  what: "In orders, bump VERSION to 1.4.1 and run make release.",
};
const T07: T = {
  id: "T07",
  title: "Roll orders 1.4.1 out",
  deps: ["T06"],
  what: "In orders, set image.tag to 1.4.1 in deploy/chart/values.yaml.",
};
const T08: T = {
  id: "T08",
  title: "Upgrade x/net in webshop",
  what: `In webshop, run go get ${GO.pkg}@v${GO.fixed} and go mod tidy.`,
  accept: "`make test` passes",
};
const T09: T = {
  id: "T09",
  title: "Release webshop 1.4.3",
  deps: ["T08"],
  what: "Tag v1.4.3 in webshop; the release workflow pushes ghcr.io/pm-example/webshop:1.4.3.",
};
const T10: T = {
  id: "T10",
  title: "Roll webshop 1.4.3 out",
  deps: ["T09"],
  what: "In argocd, set newTag: 1.4.3 in workloads/webshop/kustomization.yaml.",
};
const ALL = [T01, T02, T03, T04, T05, T06, T07, T08, T09, T10];
const swap = (t: T, over: Partial<T>) => ALL.map((x) => (x.id === t.id ? { ...x, ...over } : x));

const GATED = [
  "hit-repos-covered",
  "fix-reaches-deploy",
  "right-bump",
  "no-unproven-safe",
  "repos-registered",
  "no-manager-commands",
];

describe("security-fix grader", () => {
  test("a plan that does everything right passes all six", async () => {
    const r = await grade(ALL);
    for (const id of GATED) expect({ id, passed: r.passed[id] }).toEqual({ id, passed: true });
  });

  test("webshop left out fails hit-repos-covered", async () => {
    const r = await grade(ALL.filter((t) => !["T08", "T09", "T10"].includes(t.id)));
    expect(r.passed["hit-repos-covered"]).toBe(false);
    expect(r.evidence["hit-repos-covered"]).toContain("webshop");
  });

  test("a fix that stops at the release fails fix-reaches-deploy", async () => {
    const r = await grade(ALL.filter((t) => t.id !== "T07"));
    expect(r.passed["fix-reaches-deploy"]).toBe(false);
    expect(r.evidence["fix-reaches-deploy"]).toContain("orders");
  });

  test("a rollout that does not wait for the release fails", async () => {
    const r = await grade(swap(T04, { deps: [] }));
    expect(r.passed["fix-reaches-deploy"]).toBe(false);
    expect(r.evidence["fix-reaches-deploy"]).toContain("storefront");
  });

  test("a still-affected version fails right-bump", async () => {
    const r = await grade(swap(T05, { what: `In orders, run go get ${GO.pkg}@v0.35.0.` }));
    expect(r.passed["right-bump"]).toBe(false);
    expect(r.evidence["right-bump"]).toContain("orders");
  });

  test("from-to wording judges only the target", async () => {
    const what = `Bump express from ${EXPRESS.current} to ${EXPRESS.firstFixing}.`;
    expect((await grade(swap(T01, { what }))).passed["right-bump"]).toBe(true);
  });

  test("a parent version that still resolves the affected package fails", async () => {
    const what = `In storefront, bump express to ${EXPRESS.current}.`;
    expect((await grade(swap(T01, { what }))).passed["right-bump"]).toBe(false);
  });

  test("the first fixing release named by rule passes", async () => {
    const what = `In storefront, upgrade express to the first release that pulls ${NPM.pkg} ${NPM.fixed} or later; the exact version is an open question.`;
    expect((await grade(swap(T01, { what }))).passed["right-bump"]).toBe(true);
  });

  test("bumping the flagged npm package by itself is the wrong thing", async () => {
    const what = `In storefront, run npm install ${NPM.pkg}@${NPM.fixed}.`;
    expect((await grade(swap(T01, { what }))).passed["right-bump"]).toBe(false);
  });

  test("go versions in any spelling", async () => {
    for (const what of [
      `In orders, run go get ${GO.pkg}@latest.`,
      `In orders, upgrade ${GO.pkg} to v${GO.fixed}.`,
      `In orders, upgrade ${GO.pkg} to ${GO.fixed}.`,
      "In orders, upgrade gorilla/websocket to v1.5.3, which no longer needs x/net.",
    ]) {
      expect({ what, passed: (await grade(swap(T05, { what }))).passed["right-bump"] }).toEqual({
        what,
        passed: true,
      });
    }
  });

  test("hand-editing the lockfile fails, an override passes", async () => {
    const edit = `In storefront, edit package-lock.json to set ${NPM.pkg} to ${NPM.fixed}.`;
    expect((await grade(swap(T01, { what: edit }))).passed["right-bump"]).toBe(false);
    const override = `In storefront, add an overrides entry in package.json that sets ${NPM.pkg} to ${NPM.fixed}, then run npm install.`;
    expect((await grade(swap(T01, { what: override }))).passed["right-bump"]).toBe(true);
  });

  test("a digest pin alone fails, a package upgrade passes", async () => {
    const digest = `In storefront's Dockerfile, pin the FROM image by digest: ${BASE_IMAGE.image}@sha256:0123abcd.`;
    const pinned = await grade(swap(T02, { title: "Pin storefront's base image", what: digest }));
    expect(pinned.passed["right-bump"]).toBe(false);
    expect(pinned.evidence["right-bump"]).toContain("digest");
    const apk = `In storefront's Dockerfile, add \`RUN apk upgrade --no-cache ${BASE_IMAGE.osPackage} libcrypto3\` after FROM.`;
    expect((await grade(swap(T02, { what: apk }))).passed["right-bump"]).toBe(true);
  });

  test("the worker: a cited claim passes, an uncited one or silence fails, an extra bump passes", async () => {
    expect((await grade(ALL)).passed["no-unproven-safe"]).toBe(true);
    const uncited = await grade(ALL, { epicBody: "## Scope\n\nThe worker is not affected.\n" });
    expect(uncited.passed["no-unproven-safe"]).toBe(false);
    expect(uncited.evidence["no-unproven-safe"]).toContain("worker is not affected");
    const silent = await grade(ALL, { epicBody: "## Scope\n\nFour services.\n" });
    expect(silent.passed["no-unproven-safe"]).toBe(false);
    expect(silent.evidence["no-unproven-safe"]).toContain("worker");
    const bump: T = {
      id: "T11",
      title: "Bump requests in worker",
      what: `In worker, bump ${PY.pkg} to 2.34.2.`,
    };
    expect(
      (await grade([...ALL, bump], { epicBody: "## Scope\n\nAll four.\n" })).passed[
        "no-unproven-safe"
      ],
    ).toBe(true);
  });

  test("a claim in the epic is not cited by a lockfile named only in a task", async () => {
    const cites: T = {
      id: "T11",
      title: "Record the worker's lock",
      what: `In worker, uv.lock pins ${PY.pkg} 2.34.2.`,
    };
    const r = await grade([...ALL, cites], {
      epicBody: "## Scope\n\nThe worker is not affected.\n",
    });
    expect(r.passed["no-unproven-safe"]).toBe(false);
  });

  test("repos must name orders, webshop and storefront, and argocd when a task changes it", async () => {
    expect((await grade(ALL)).passed["repos-registered"]).toBe(true);
    const noWebshop = await grade(ALL, { repos: [ORDERS_URL, STOREFRONT_URL, TARGETS.argocd] });
    expect(noWebshop.passed["repos-registered"]).toBe(false);
    expect(noWebshop.evidence["repos-registered"]).toContain("webshop");
    const noArgocd = await grade(ALL, { repos: [ORDERS_URL, TARGETS.webshop, STOREFRONT_URL] });
    expect(noArgocd.passed["repos-registered"]).toBe(false);
  });

  test("a task naming the manager's bun commands fails no-manager-commands", async () => {
    const r = await grade(swap(T05, { accept: "`bun test` passes" }));
    expect(r.passed["no-manager-commands"]).toBe(false);
  });

  test("dependency-commands records network attempts and explain commands", async () => {
    const online = await grade(ALL, {
      telemetry: {
        ...EMPTY_TELEMETRY,
        commands: ["npm view express version", `cd orders && go mod why -m ${GO.pkg}`, "ls"],
        toolCalls: { WebFetch: 1 },
      },
    });
    expect(online.passed["dependency-commands"]).toBe(false);
    for (const s of ["npm view", "WebFetch", "go mod why"]) {
      expect(online.evidence["dependency-commands"]).toContain(s);
    }
    const offline = await grade(ALL, { telemetry: { ...EMPTY_TELEMETRY, commands: ["ls"] } });
    expect(offline.passed["dependency-commands"]).toBe(true);
  });
});
