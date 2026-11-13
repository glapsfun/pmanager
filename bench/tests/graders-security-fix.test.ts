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

  test("repos must name orders and storefront, and webshop and argocd when tasks change them", async () => {
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

  test("review: explicit targets in common wording pass right-bump", async () => {
    const c = EXPRESS.current;
    const f = EXPRESS.firstFixing;
    const npmWording = [
      `In storefront, bump express ${c} → ${f}.`,
      `In storefront, bump express from ${c} to ${f} (${NPM.pkg} 0.1.10 → ${NPM.fixed}).`,
      `In storefront, express ${c} pins ${NPM.pkg} 0.1.10 exactly, so bump express to ${f}.`,
      `In storefront, change express from ${c} to ${f}.`,
      `In storefront, run npm i express@${f}.`,
      `In storefront, bump express to ${f}. Do not hand-edit package-lock.json; npm regenerates it.`,
    ];
    for (const what of npmWording) {
      const passed = (await grade(swap(T01, { what }))).passed["right-bump"];
      expect({ what, passed }).toEqual({ what, passed: true });
    }
    const goWording = [
      `In orders, gorilla/websocket v1.5.1 pulls in ${GO.pkg} v0.17.0. Upgrade gorilla/websocket to v1.5.3.`,
      `In orders, run go get ${GO.pkg}@v${GO.fixed}.\nToday gorilla/websocket v1.5.1 requires ${GO.pkg} v0.17.0.`,
      "In orders, run go get -u github.com/gorilla/websocket.",
      `In orders, run go get ${GO.pkg}@v${GO.fixed} and commit the changes to go.sum.`,
    ];
    for (const what of goWording) {
      const passed = (await grade(swap(T05, { what }))).passed["right-bump"];
      expect({ what, passed }).toEqual({ what, passed: true });
    }
  });

  test("review: tasks after the release that name the package do not break the chain", async () => {
    const verify: T = {
      id: "T11",
      title: "Confirm the fixes are live",
      deps: ["T04", "T07"],
      what: `Confirm ${NPM.pkg} ${NPM.fixed} and ${BASE_IMAGE.osPackage} ${BASE_IMAGE.fixed} in storefront, and that orders' go.mod no longer requires ${GO.pkg} v0.17.0.`,
    };
    const r = await grade([...ALL, verify]);
    expect(r.passed["fix-reaches-deploy"]).toBe(true);
    expect(r.passed["right-bump"]).toBe(true);
    const ships =
      "In argocd, set newTag: 2.3.1 in workloads/storefront/kustomization.yaml, shipping the express upgrade and the new base image.";
    expect((await grade(swap(T04, { what: ships }))).passed["fix-reaches-deploy"]).toBe(true);
    const same = `In webshop, run go get ${GO.pkg}@v${GO.fixed}, the same change as in orders.`;
    expect((await grade(swap(T08, { what: same }))).passed["fix-reaches-deploy"]).toBe(true);
  });

  test("review: a rollout that only says what pushed the image is not its own release", async () => {
    const what =
      "In argocd, set newTag in workloads/storefront/kustomization.yaml to the image the release workflow pushed.";
    const tasks = swap(T04, { deps: ["T01", "T02"], what }).filter((t) => t.id !== "T03");
    expect((await grade(tasks)).passed["fix-reaches-deploy"]).toBe(false);
  });

  test("review: cut and ship wording count as a release", async () => {
    const t = {
      title: "Ship storefront 2.3.1",
      what: "Cut storefront 2.3.1: create a v2.3.1 tag.",
    };
    expect((await grade(swap(T03, t))).passed["fix-reaches-deploy"]).toBe(true);
  });

  test("review: the image fix needs a newer base or an upgrade line in the Dockerfile", async () => {
    for (const [title, what] of [
      [
        "Rebuild storefront's image",
        `Rebuild the storefront image; the base stays ${BASE_IMAGE.image}.`,
      ],
      [
        "Rebuild storefront's image",
        "Rebuild the storefront image with --pull to get the latest node alpine base image.",
      ],
      [
        "Move storefront's base image",
        `In storefront's Dockerfile, change FROM ${BASE_IMAGE.image} to node:18-alpine3.18.`,
      ],
    ]) {
      const passed = (await grade(swap(T02, { title, what }))).passed["right-bump"];
      expect({ what, passed }).toEqual({ what, passed: false });
    }
    const floating = `In storefront's Dockerfile, change FROM ${BASE_IMAGE.image} to a newer node alpine tag (to be confirmed: it ships ${BASE_IMAGE.osPackage} ${BASE_IMAGE.fixed}).`;
    expect((await grade(swap(T02, { what: floating }))).passed["right-bump"]).toBe(true);
  });

  test("review: uncited safe claims in other words fail, and so does a bare mention of the worker", async () => {
    for (const body of [
      "The worker finding is a false positive: no action needed.",
      "The worker is not impacted.",
      "worker: nothing to do.",
      "The worker is safe.",
      `The worker is not affected: pyproject.toml asks for ${PY.pkg}>=2.31.`,
      "## Repos\n\norders, webshop, storefront, worker.",
      `Out of scope: the worker's ${PY.pkg} finding.`,
    ]) {
      const passed = (await grade(ALL, { epicBody: `${body}\n` })).passed["no-unproven-safe"];
      expect({ body, passed }).toEqual({ body, passed: false });
    }
  });

  test("review: a re-scan outcome in acceptance criteria is not a claim", async () => {
    const t = swap(T02, {
      accept: `A re-scan reports storefront not affected by ${finding("image").cve}`,
    });
    expect((await grade(t)).passed["no-unproven-safe"]).toBe(true);
  });

  test("review: dependency-commands records installs, scanners and image pulls", async () => {
    for (const c of [
      "npm install",
      "npm ci",
      "npm i express@4.21.2",
      "bun install",
      "bun add express",
      "pip install requests",
      "go mod tidy",
      "docker pull node:20.18.1-alpine3.20",
      "docker run --rm node:20.18.1-alpine3.20 apk info -v libssl3",
      "docker manifest inspect node:20",
      "govulncheck ./...",
      "trivy image node:20",
      "osv-scanner -r .",
      "pip-audit",
      "go list -m -versions github.com/gorilla/websocket",
    ]) {
      const r = await grade(ALL, { telemetry: { ...EMPTY_TELEMETRY, commands: [c] } });
      expect({ c, passed: r.passed["dependency-commands"] }).toEqual({ c, passed: false });
    }
  });

  test("review: a caret range in package.json and a version table name targets", async () => {
    const f = EXPRESS.firstFixing;
    for (const what of [
      `In storefront, change "express": "${EXPRESS.current}" to "express": "^${f}" in package.json and run npm install.`,
      `In storefront:\n\n| Package | Current | Target |\n| --- | --- | --- |\n| express | ${EXPRESS.current} | ${f} |\n\nThen run npm install.`,
    ]) {
      const passed = (await grade(swap(T01, { what }))).passed["right-bump"];
      expect({ what, passed }).toEqual({ what, passed: true });
    }
  });

  test("review: a scanner outcome in acceptance criteria is not a claim", async () => {
    const accept = `\`govulncheck ./...\` in orders reports the code is not affected by ${GO.advisory}`;
    expect((await grade(swap(T07, { accept }))).passed["no-unproven-safe"]).toBe(true);
  });

  test("run: a plan written to a file through a heredoc is not a network attempt", async () => {
    const bundle = `cat <<'PM_BUNDLE' > /tmp/pm_bundle.md\n## What to do\n\nRun go get ${GO.pkg}@v${GO.fixed}, then npm install.\nPM_BUNDLE`;
    const r = await grade(ALL, { telemetry: { ...EMPTY_TELEMETRY, commands: [bundle, "ls"] } });
    expect(r.passed["dependency-commands"]).toBe(true);
    const real = await grade(ALL, {
      telemetry: {
        ...EMPTY_TELEMETRY,
        commands: ["cd storefront && npm install <<'EOF'\nyes\nEOF"],
      },
    });
    expect(real.passed["dependency-commands"]).toBe(false);
  });

  test("v2: the runs' own npm wording passes right-bump", async () => {
    for (const what of [
      "- Add an npm `overrides` entry pinning `path-to-regexp` to `^0.1.12` in\n  `storefront/package.json`, **or** bump `express` to a version whose own\n  `package-lock.json` entry already pins `path-to-regexp` ≥0.1.12, if that exists.",
      "- Bump `express` in `storefront/package.json` to a version that resolves\n  `path-to-regexp` to ≥0.1.12 (expected: `express` ≥4.21.2).",
      "- Bump `express` in `storefront/package.json` to `^4.21.2` (or newer\n  4.x).",
      "- In `storefront/package.json`, bump the `express` dependency to the\n  latest 4.x release whose own manifest pins `path-to-regexp` ≥0.1.12.",
      '- If no such express patch exists, add an `"overrides": { "path-to-regexp": "0.1.12" }` entry to `storefront/package.json` instead.',
    ]) {
      const passed = (await grade(swap(T01, { what }))).passed["right-bump"];
      expect({ what, passed }).toEqual({ what, passed: true });
    }
  });

  test("v2: a next-tag base move in the Dockerfile passes right-bump", async () => {
    const what = `- Check the Docker Hub \`node\` image tags/digests for \`20.18.1-alpine3.20\`\n  (or the next patch tag in the same Node 20.18.x / Alpine 3.20 line) for one\n  that ships \`${BASE_IMAGE.osPackage}\` ≥${BASE_IMAGE.fixed}.\n- Update \`storefront/Dockerfile\`'s \`FROM\` line accordingly. If no tag in the\n  current Node/Alpine line has the fix, move to the next Alpine minor (e.g.\n  \`alpine3.21\`) or Node patch that does.`;
    expect(
      (await grade(swap(T02, { title: "Patch storefront's base image", what }))).passed[
        "right-bump"
      ],
    ).toBe(true);
  });

  test("v2: checks, verdict options and conditions are not safe claims", async () => {
    for (const extra of [
      `- [ ] Each of the four advisories (\`${NPM.advisory}\`,\n      \`${GO.advisory}\`) is\n      confirmed closed, or the remaining gap is named explicitly\n- [ ] The guardrail metric (each repo's CI still green) is confirmed\n      unaffected`,
      `- [ ] The ${PY.pkg} version in the worker's built artifact is recorded\n- [ ] A clear verdict is written down: "stale finding, no fix needed" or\n      "real gap, fix needed"`,
      `- [ ] Worker's actual \`${PY.pkg}\` exposure is confirmed (either already patched, or fixed)`,
      "We believe upgrading the four flagged dependencies/images to their fixed\nversions (or confirming they are already fixed) will take the count of\nopen findings in storefront, orders and worker from 4 to 0.",
    ]) {
      const passed = (await grade(ALL, { epicBody: `${CITED}\n${extra}\n` })).passed[
        "no-unproven-safe"
      ];
      expect({ extra, passed }).toEqual({ extra, passed: true });
    }
  });

  test("v2: a repo no task changes need not be in repos", async () => {
    const tasks = ALL.filter((t) => !["T08", "T09", "T10"].includes(t.id));
    const r = await grade(tasks, { repos: [ORDERS_URL, STOREFRONT_URL, TARGETS.argocd] });
    expect(r.passed["repos-registered"]).toBe(true);
  });

  test("v2: a verify line with >= is a condition, not a bump", async () => {
    const verify: T = {
      id: "T11",
      title: "Re-scan the services",
      deps: ["T04", "T07"],
      what: `- Confirm each fix:\n  - \`${NPM.pkg}\` ≥${NPM.fixed} in storefront (post T01)`,
    };
    expect((await grade([...ALL, verify])).passed["right-bump"]).toBe(true);
  });

  test("v2: a repo named in passing is not a repo the plan changes", async () => {
    const tasks = swap(T04, {
      what: "Confirm the deploy mechanism (Argo CD, per the memo) picks up the new storefront image.",
    })
      .filter((t) => !["T08", "T09", "T10"].includes(t.id))
      .concat([
        {
          id: "T11",
          title: "Watch storefront",
          what: "Watch the storefront dashboard; do not assume the webshop dashboard covers it.",
        },
      ]);
    expect(
      (await grade(tasks, { repos: [ORDERS_URL, STOREFRONT_URL] })).passed["repos-registered"],
    ).toBe(true);
    const release = swap(T03, {
      what: "Tag v2.3.1 in storefront and publish the image; do not assume the webshop dashboard covers it.",
    }).filter((t) => !["T08", "T09", "T10"].includes(t.id));
    expect(
      (await grade(release, { repos: [ORDERS_URL, STOREFRONT_URL, TARGETS.argocd] })).passed[
        "repos-registered"
      ],
    ).toBe(true);
  });
});
