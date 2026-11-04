import { describe, expect, test } from "bun:test";
import { TARGETS } from "../../ci/e2e/workspace";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY } from "../adapters/types";
import { headSha } from "../fixture";
import { buildCheckContext } from "../graders/context";
import { multiRepoContextChecks, targetsOf } from "../graders/multi-repo-context";
import { runChecks } from "../graders/types";

interface T {
  id: string;
  title: string;
  deps?: string[];
  what: string;
  accept: string;
  outOfScope?: string;
}

const SLUG = "webshop-canary";
const ALL = [TARGETS.webshop, TARGETS.infra, TARGETS.argocd];

function taskFile(t: T): string {
  return `---
id: ${t.id}
epic: ${SLUG}
milestone: M1
title: ${t.title}
status: todo
priority: must
depends-on: [${(t.deps ?? []).join(", ")}]
estimate: S
owner: unassigned
updated: 2026-09-15
contract: 1
---

# ${t.id} ${t.title}

## Context

Part of the canary epic; the argocd repo and the infra repo also change.

## What to do

${t.what}

## Acceptance criteria

- [ ] ${t.accept}

## Out of scope

${t.outOfScope ?? "none"}

## Notes
`;
}

/** A repo holding one sample plan, graded the way a run's plan is. */
async function grade(tasks: T[], repos: string[] = ALL) {
  const dir = await makeTempDir("mrc-plan");
  await initGitRepo(dir);
  const baselineSha = await headSha(dir);
  const files: Record<string, string> = {
    [`docs/pm/${SLUG}/epic.md`]: `---\nid: ${SLUG}\ntitle: Webshop canary\ntype: feature\nstatus: draft\ncreated: 2026-09-15\nupdated: 2026-09-15\ncontract: 1\nrepos:\n${repos.map((u) => `  - ${u}`).join("\n")}\n---\n\n# Webshop canary\n`,
    [`docs/pm/${SLUG}/plan.md`]: `---\nepic: ${SLUG}\nstatus: draft\nupdated: 2026-09-15\ncontract: 1\n---\n\n# Plan\n\n## Milestones\n\n### M1: Canary live\n`,
  };
  for (const t of tasks) files[`docs/pm/${SLUG}/tasks/${t.id}-x.md`] = taskFile(t);
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "plan"], dir);
  const info = {
    baselineSha,
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [],
    initialDirty: {},
  };
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(multiRepoContextChecks(), ctx);
  return Object.fromEntries(res.map((r) => [r.id, r.passed]));
}

const VERSION: T = {
  id: "T01",
  title: "Report the running version from the webshop service",
  what: "In the webshop repo, add a /version handler in main.go and a test in main_test.go.",
  accept: "`make test` passes and GET /version returns the build version",
};
const RELEASE: T = {
  id: "T02",
  title: "Release webshop 1.6.0 with the version endpoint",
  deps: ["T01"],
  what: "Tag v1.6.0 in the webshop repo so the release workflow publishes the image.",
  accept: "the image ghcr.io/pm-example/webshop:1.6.0 exists",
};
const LB: T = {
  id: "T03",
  title: "Add the canary load balancer",
  what: "In the infra repo add an hcloud_load_balancer for the canary in modules/cluster and envs/prod, and open a pull request so CI posts the plan and applies after merge.",
  accept: "`terraform validate` and `tflint --recursive` pass",
};
const CANARY: T = {
  id: "T04",
  title: "Run the canary Deployment and send 10% of traffic",
  deps: ["T02", "T03"],
  what: "In the argocd repo add a canary Deployment under workloads/webshop with newTag 1.6.0 and an ingress canary weight of 10.",
  accept: "`kubeconform` passes for workloads/webshop",
};
const GOOD = [VERSION, RELEASE, LB, CANARY];
const IDS = [
  "own-checks-webshop",
  "own-checks-infra",
  "own-checks-argocd",
  "no-manager-commands",
  "conventions",
  "cross-repo-order",
  "repos-registered",
];

describe("multi-repo-context graders", () => {
  test("a good plan passes all seven checks", async () => {
    const r = await grade(GOOD);
    expect(IDS.map((id) => [id, r[id]])).toEqual(IDS.map((id) => [id, true]));
  });

  test("a plan with the manager's commands, workstation applies and no order fails all seven", async () => {
    const r = await grade(
      [
        { ...VERSION, accept: "`bun test` passes" },
        {
          id: "T02",
          title: "Add the canary load balancer",
          what: "Add an hcloud_load_balancer in envs/prod and run `terraform apply` from your laptop.",
          accept: "`bun run lint` passes",
        },
        {
          id: "T03",
          title: "Canary deployment",
          what: "Add workloads/webshop/canary.yaml, then `kubectl apply -f` it and send 10% of traffic.",
          accept: "`bun test` passes",
        },
      ],
      [TARGETS.webshop],
    );
    expect(IDS.map((id) => [id, r[id]])).toEqual(IDS.map((id) => [id, false]));
  });

  test("no infra task fails the infra-dependent checks", async () => {
    const r = await grade([VERSION, RELEASE, { ...CANARY, deps: ["T02"] }]);
    for (const id of [
      "own-checks-infra",
      "no-manager-commands",
      "conventions",
      "cross-repo-order",
    ]) {
      expect([id, r[id]]).toEqual([id, false]);
    }
    expect(r["own-checks-webshop"]).toBe(true);
  });

  test("one task that releases the webshop and switches traffic fails cross-repo-order", async () => {
    const combined: T = {
      id: "T02",
      title: "Release webshop 1.6.0 and send 10% of traffic to the canary",
      deps: ["T01", "T03"],
      what: "Tag v1.6.0 in the webshop repo, then in the argocd repo set newTag 1.6.0 for the canary in workloads/webshop and an ingress canary weight of 10.",
      accept: "`kubeconform` passes for workloads/webshop",
    };
    expect((await grade([VERSION, combined, LB]))["cross-repo-order"]).toBe(false);
  });

  test("conventions: CI applies passes, a hand kubectl apply fails", async () => {
    const hand = { ...CANARY, what: `${CANARY.what} Then \`kubectl apply -f\` the canary.` };
    expect((await grade([VERSION, RELEASE, LB, hand])).conventions).toBe(false);
    const negated = {
      ...CANARY,
      what: `${CANARY.what} Never \`kubectl apply\` by hand; Argo CD syncs main.`,
    };
    expect((await grade([VERSION, RELEASE, LB, negated])).conventions).toBe(true);
  });

  test("repos in scp form still pass repos-registered", async () => {
    const scp = ALL.map((u) => u.replace(/^https:\/\/github\.com\/(.+)$/, "git@github.com:$1"));
    expect((await grade(GOOD, scp))["repos-registered"]).toBe(true);
  });
});

describe("realistic phrasings", () => {
  test("tasks named only by repo or artifact are attributed", async () => {
    const version: T = {
      id: "T01",
      title: "Expose GET /version on the webshop service",
      what: "Return the build version from the webshop service.",
      accept: "`make test` and `make lint` pass",
    };
    const release: T = {
      id: "T02",
      title: "Cut webshop 1.6.0",
      deps: ["T01"],
      what: "Push a `v1.6.0` tag on webshop `main`; the release workflow publishes ghcr.io/pm-example/webshop:1.6.0.",
      accept: "the 1.6.0 image exists",
    };
    const lb: T = {
      ...LB,
      what: "Add the canary load balancer in infra; the PR is merged and the change is applied by CI.",
      accept: "`terraform -chdir=envs/prod validate` passes",
    };
    const weight: T = {
      id: "T04",
      title: "Send 10% of traffic to the canary",
      deps: ["T02", "T03"],
      what: "Set canary-weight 10 on the canary ingress; Argo CD syncs it.",
      accept: "`kubeconform` passes",
    };
    const r = await grade([version, release, lb, weight]);
    expect(IDS.map((id) => [id, r[id]])).toEqual(IDS.map((id) => [id, true]));
  });

  test("a task with an infra path and a mention of the argocd repo is infra only", async () => {
    const dir = await makeTempDir("mrc-attr");
    const t: T = { ...LB, what: `${LB.what} Keep the output names the argocd repo reads.` };
    await writeTree(dir, {
      [`docs/pm/${SLUG}/epic.md`]: `---\nid: ${SLUG}\n---\n`,
      [`docs/pm/${SLUG}/tasks/T03-x.md`]: taskFile(t),
    });
    const task = (await loadPmRepo(dir)).epics[0]?.tasks[0];
    if (!task) throw new Error("task missing");
    expect(targetsOf(task)).toEqual(["infra"]);
  });

  test("conventions reads sentences and clauses, not lines", async () => {
    const lbWith = (what: string): T => ({ ...LB, what });
    const ok = [
      "Add an hcloud_load_balancer in envs/prod and open a pull request; merge it and the `apply` workflow runs `terraform apply` on main.",
      "Add an hcloud_load_balancer in envs/prod. Do not run\n`terraform apply` from a workstation; CI applies after merge.",
    ];
    for (const what of ok)
      expect((await grade([VERSION, RELEASE, lbWith(what), CANARY])).conventions).toBe(true);
    const bad = [
      "Add an hcloud_load_balancer in envs/prod and run `terraform apply` from your laptop; no CI needed.",
      "Run `terraform apply` from envs/prod. Do not touch the existing LB; CI posts the plan.",
    ];
    for (const what of bad)
      expect((await grade([VERSION, RELEASE, lbWith(what), CANARY])).conventions).toBe(false);
  });

  test("checks written under Notes count, and bun run test is a manager command", async () => {
    const noted: T = { ...VERSION, accept: "GET /version returns the build version" };
    const dir = await grade([
      { ...noted, what: `${noted.what}\n\n## Notes\n\nChecks: make test, make lint.` },
      RELEASE,
      LB,
      CANARY,
    ]);
    expect(dir["own-checks-webshop"]).toBe(true);
    const leaked = await grade([
      { ...VERSION, accept: "`bun run test` passes" },
      RELEASE,
      LB,
      CANARY,
    ]);
    expect(leaked["no-manager-commands"]).toBe(false);
  });
});

describe("targetsOf", () => {
  test("reads the title and the work, not Context or Out of scope", async () => {
    const dir = await makeTempDir("mrc-attr");
    const canary: T = {
      ...CANARY,
      title: "Canary webshop Deployment in workloads/webshop",
      outOfScope:
        "- The /version handler in main.go (T01).\n- The load balancer in envs/prod (T03).",
    };
    await writeTree(dir, {
      [`docs/pm/${SLUG}/epic.md`]: `---\nid: ${SLUG}\n---\n`,
      [`docs/pm/${SLUG}/tasks/T04-x.md`]: taskFile(canary),
    });
    const repo = await loadPmRepo(dir);
    const task = repo.epics[0]?.tasks[0];
    if (!task) throw new Error("task missing");
    expect(targetsOf(task)).toEqual(["argocd"]);
  });
});
