import { describe, expect, test } from "bun:test";
import {
  gitOk,
  initGitRepo,
  makeTempDir,
  writeTree,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { EMPTY_TELEMETRY } from "../adapters/types";
import { headSha } from "../fixture";
import { buildCheckContext } from "../graders/context";
import {
  crossRepoEndpointChecks,
  crossRepoOutputChecks,
  type Repo,
  reposOf,
} from "../graders/cross-repo-links";
import { runChecks } from "../graders/types";

interface T {
  id: string;
  title?: string;
  deps?: string[];
  parts?: string[];
  status?: string;
  what: string;
  accept?: string;
}

const SLUG = "links";

function taskFile(t: T): string {
  const title = t.title ?? "Task";
  return `---
id: ${t.id}
epic: ${SLUG}
milestone: M1
title: ${title}
status: ${t.status ?? "todo"}
priority: must
depends-on: [${(t.deps ?? []).join(", ")}]
parts: [${(t.parts ?? []).join(", ")}]
estimate: S
owner: unassigned
updated: 2026-11-19
contract: 1
---

# ${t.id} ${title}

## Context

Part of the links epic.

## What to do

${t.what}

## Acceptance criteria

- [ ] ${t.accept ?? "done"}

## Out of scope

none

## Notes
`;
}

async function grade(tasks: T[], checks: ReturnType<typeof crossRepoEndpointChecks>) {
  const dir = await makeTempDir("links-plan");
  await initGitRepo(dir);
  const base = await headSha(dir);
  const files: Record<string, string> = {
    [`docs/pm/${SLUG}/epic.md`]: `---\nid: ${SLUG}\ntitle: Links\ntype: feature\nstatus: draft\ncreated: 2026-11-19\nupdated: 2026-11-19\ncontract: 1\n---\n\n# Links\n`,
    [`docs/pm/${SLUG}/plan.md`]: `---\nepic: ${SLUG}\nstatus: draft\nupdated: 2026-11-19\ncontract: 1\n---\n\n# Plan\n\n## Milestones\n\n### M1: Done\n`,
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
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(checks, ctx);
  return {
    passed: Object.fromEntries(res.map((r) => [r.id, r.passed])),
    evidence: Object.fromEntries(res.map((r) => [r.id, r.evidence])),
  };
}

const endpoint = (tasks: T[]) => grade(tasks, crossRepoEndpointChecks());
const output = (tasks: T[]) => grade(tasks, crossRepoOutputChecks());

const E1: T = {
  id: "T01",
  what: "In orders, add `total` with `amount_cents` and `currency` to GET /orders alongside `total_cents`.",
};
const E2: T = {
  id: "T02",
  what: "In webshop, read `amount_cents` and `currency` from the order total in history.go.",
};
const E3: T = {
  id: "T03",
  deps: ["T02"],
  what: "In webshop, tag v1.5.0 and let the release workflow push the image.",
};
const E4: T = {
  id: "T04",
  deps: ["T03"],
  what: "In argocd, set newTag: 1.5.0 in workloads/webshop/kustomization.yaml.",
};
const E5: T = {
  id: "T05",
  deps: ["T04"],
  what: "In orders, remove `total_cents` from GET /orders.",
};

describe("cross-repo-endpoint", () => {
  test("serve both, webshop moves, removal waits for rollout", async () => {
    const r = await endpoint([E1, E2, E3, E4, E5]);
    expect(r.passed["client-covered"]).toBe(true);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("removal waits only for the webshop code change", async () => {
    const r = await endpoint([E1, E2, E3, E4, { ...E5, deps: ["T02"] }]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
    expect(r.evidence["client-safe-rollout"]).toContain("T05");
  });

  test("both shapes served, removal deferred", async () => {
    const r = await endpoint([E1, E2]);
    expect(r.passed["client-covered"]).toBe(true);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("one breaking orders task, no client", async () => {
    const r = await endpoint([
      { id: "T01", what: "In orders, replace `total_cents` with `total`." },
    ]);
    expect(r.passed["client-covered"]).toBe(false);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("a passing mention does not place a task", async () => {
    const r = await endpoint([
      { id: "T01", what: "In orders, replace `total_cents` with `total`; webshop unaffected." },
    ]);
    expect(r.passed["client-covered"]).toBe(false);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("release and rollout in the webshop task itself", async () => {
    const r = await endpoint([
      E1,
      {
        id: "T02",
        what: "In webshop, read `currency` in history.go, tag v1.5.0, and set newTag: 1.5.0 in argocd.",
      },
      { ...E5, id: "T03", deps: ["T02"] },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("a descoped client task does not count", async () => {
    const r = await endpoint([E1, { ...E2, status: "descoped" }]);
    expect(r.passed["client-covered"]).toBe(false);
  });
});

describe("cross-repo-endpoint negation and keeps", () => {
  const later = { ...E5, deps: ["T04"] };
  test.each([
    ["without removing", "In orders, add `total` without removing `total_cents`."],
    ["do not drop", "In orders, add `total`. Do not drop total_cents yet."],
  ])("%s in an add task is not a removal", async (_n, what) => {
    const r = await endpoint([{ ...E1, what }, E2, E3, E4, later]);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("replace but keep the old field is not a removal", async () => {
    const r = await endpoint([
      {
        id: "T01",
        what: "In orders, replace `total_cents` with `total`, keeping `total_cents` alongside.",
      },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("a task that removes the field with nothing kept is a removal", async () => {
    const r = await endpoint([
      E1,
      E2,
      { id: "T03", deps: ["T02"], what: "In orders, remove `total_cents`." },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("removing the deprecated field is still a removal", async () => {
    const r = await endpoint([
      E1,
      E2,
      E3,
      E4,
      { id: "T05", deps: ["T02"], what: "In orders, remove the deprecated `total_cents` field." },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
    expect(r.evidence["client-safe-rollout"]).toContain("T05");
  });
});

const O1: T = {
  id: "T01",
  what: "In infra, create `pm-example-webshop-media` with versioning and a 90-day noncurrent expiry in envs/prod/assets.tf.",
};
const O2: T = { id: "T02", deps: ["T01"], what: "Copy the objects into the new bucket." };
const O3: T = {
  id: "T03",
  deps: ["T02"],
  what: "In argocd, set `ASSETS_BUCKET` to `pm-example-webshop-media` in workloads/webshop/deployment.yaml.",
};
const O4: T = {
  id: "T04",
  deps: ["T03"],
  what: "In infra, delete `pm-example-webshop-assets`.",
};

describe("cross-repo-output", () => {
  test("create, copy, switch, delete in order", async () => {
    const r = await output([O1, O2, O3, O4]);
    expect(r.passed["consumer-covered"]).toBe(true);
    expect(r.passed["switch-order"]).toBe(true);
  });

  test("a generic search task is not the consumer", async () => {
    const r = await output([
      O1,
      {
        id: "T02",
        deps: ["T01"],
        what: "Find and update every reference to `pm-example-webshop-assets`.",
      },
      { ...O4, id: "T03", deps: ["T02"] },
    ]);
    expect(r.passed["consumer-covered"]).toBe(false);
    expect(r.passed["switch-order"]).toBe(false);
  });

  test("the webshop rollout task is not the switch", async () => {
    const r = await output([
      O1,
      {
        id: "T02",
        deps: ["T01"],
        parts: ["argocd/workloads/webshop"],
        what: "Set newTag: 1.5.0 in workloads/webshop/kustomization.yaml.",
      },
      { ...O4, id: "T03", deps: ["T02"] },
    ]);
    expect(r.passed["consumer-covered"]).toBe(false);
  });

  test("a parts-placed switch that names the bucket", async () => {
    const r = await output([
      O1,
      {
        ...O3,
        parts: ["argocd/workloads/webshop"],
        what: "Point the webshop deployment at `pm-example-webshop-media`.",
      },
    ]);
    expect(r.passed["consumer-covered"]).toBe(true);
  });

  test("switch before the bucket exists", async () => {
    const r = await output([O1, { ...O3, deps: [] }]);
    expect(r.passed["switch-order"]).toBe(false);
    expect(r.evidence["switch-order"]).toContain("T03");
  });

  test("delete before the switch", async () => {
    const r = await output([O1, O2, O3, { ...O4, deps: ["T01"] }]);
    expect(r.passed["switch-order"]).toBe(false);
    expect(r.evidence["switch-order"]).toContain("T04");
  });

  test("a deferred delete in the create task does not make it a delete task", async () => {
    const r = await output([
      { ...O1, what: `${O1.what} Do not delete the old bucket yet.` },
      O2,
      O3,
      O4,
    ]);
    expect(r.passed["switch-order"]).toBe(true);
  });

  test("webshop config is not argocd", async () => {
    const r = await output([
      O1,
      { id: "T03", deps: ["T01"], what: "Update webshop's config to the new bucket." },
    ]);
    expect(r.passed["consumer-covered"]).toBe(false);
  });

  test("no switch and no delete", async () => {
    const r = await output([O1]);
    expect(r.passed["switch-order"]).toBe(null);
    expect(r.evidence["switch-order"]).toBe("nothing to order");
  });
});

const ORDERS_ADD: T = {
  id: "T01",
  parts: ["orders"],
  what: "In `internal/orders/store.go`, add `total` (`amount_cents`, `currency`) to GET /orders, still serving `total_cents`.",
};
const WS_CHANGE: T = {
  id: "T02",
  parts: ["webshop"],
  deps: ["T01"],
  what: "In `history.go`, decode `total.amount_cents` and `total.currency`.",
};

describe("cross-repo-endpoint hedged and search tasks", () => {
  const one: T = {
    id: "T01",
    parts: ["orders"],
    what: "In `internal/orders/store.go`, replace `total_cents` with `total` (`amount_cents`, `currency`).",
  };
  test.each([
    [
      "conditional audit",
      {
        id: "T02",
        parts: ["webshop"],
        deps: ["T01"],
        what: "Search webshop for any use of `total_cents`; if it reads the field, update it to `total`.",
      },
    ],
    [
      "smoke test",
      {
        id: "T02",
        parts: ["webshop"],
        deps: ["T01"],
        what: "After orders ships, smoke-test webshop pages; `total_cents` is gone from orders' response.",
      },
    ],
    [
      "grep every repo",
      {
        id: "T02",
        what: "Grep orders, webshop, infra and argocd for `total_cents` and list every consumer.",
      },
    ],
  ] as [string, T][])("%s does not cover the client", async (_n, task) => {
    const r = await endpoint([one, task]);
    expect(r.passed["client-covered"]).toBe(false);
  });

  test("a plain decode task in history.go covers the client", async () => {
    const r = await endpoint([
      one,
      {
        id: "T02",
        parts: ["webshop"],
        what: "In webshop's `history.go`, decode `total.amount_cents`.",
      },
    ]);
    expect(r.passed["client-covered"]).toBe(true);
  });

  test("a Go struct field and a Total object name the field", async () => {
    for (const what of [
      "Update the order history page in `history.go` to read the new Total object and show its Currency.",
      "In `history.go`, replace the `TotalCents` field with the new struct.",
    ]) {
      const r = await endpoint([ORDERS_ADD, { id: "T02", parts: ["webshop"], what }]);
      expect(r.passed["client-covered"]).toBe(true);
    }
  });
});

describe("cross-repo-endpoint keeps and removal phrasing", () => {
  const later = (what: string, accept?: string): T => ({
    id: "T05",
    parts: ["orders"],
    deps: ["T02"],
    what,
    accept,
  });
  const base = [ORDERS_ADD, WS_CHANGE];

  test("an acceptance line saying keep passing is not a keep", async () => {
    const r = await endpoint([
      ...base,
      later("Remove `total_cents` from GET /orders.", "`make test` and `make lint` keep passing"),
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("both files in a one-shot replace is not a keep", async () => {
    const r = await endpoint([
      {
        id: "T01",
        parts: ["orders"],
        what: "Replace `total_cents` with `total` in both `store.go` and `store_test.go`.",
      },
      { ...WS_CHANGE, deps: [] },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("not backward compatible is not a keep", async () => {
    const r = await endpoint([
      ...base,
      later("Remove `total_cents` from GET /orders. This is not backward compatible."),
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("a removal with no webshop task and keep passing fails", async () => {
    const r = await endpoint([
      {
        id: "T01",
        parts: ["orders"],
        what: "Replace `total_cents` with `total` in `internal/orders/store.go`.",
        accept: "`make test` and `make lint` keep passing",
      },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("both shapes in one task is a keep", async () => {
    const r = await endpoint([
      {
        id: "T01",
        parts: ["orders"],
        what: "Replace `total_cents` handling so GET /orders serves both shapes.",
      },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("stop returning is a removal", async () => {
    const r = await endpoint([...base, later("Stop returning `total_cents` from GET /orders.")]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("no longer includes is a removal", async () => {
    const r = await endpoint([...base, later("GET /orders no longer includes `total_cents`.")]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("an expand task that says the removal comes later is not a removal", async () => {
    const r = await endpoint([
      {
        ...ORDERS_ADD,
        what: "Add `total` (`amount_cents`, `currency`) to GET /orders; `total_cents` is removed later in T05, after webshop moves.",
      },
      WS_CHANGE,
      { ...E3, id: "T03", deps: ["T02"] },
      { ...E4, id: "T04", deps: ["T03"] },
      { ...E5, id: "T05", deps: ["T04"] },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });

  test("a removal that starts with once the rollout is live is still a removal", async () => {
    const r = await endpoint([
      ...base,
      later("Once webshop 1.5.0 is live, drop `total_cents` from GET /orders."),
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });
});

describe("cross-repo-endpoint rollout chain", () => {
  test("a rollout with no edge to the webshop change does not unlock the removal", async () => {
    const r = await endpoint([
      ORDERS_ADD,
      WS_CHANGE,
      { ...E3, id: "T03", deps: ["T02"] },
      { ...E4, id: "T04", deps: [] },
      { ...E5, id: "T05", deps: ["T04"] },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(false);
  });

  test("a rollout that reaches the webshop change unlocks it", async () => {
    const r = await endpoint([
      ORDERS_ADD,
      WS_CHANGE,
      { ...E3, id: "T03", deps: ["T02"] },
      { ...E4, id: "T04", deps: ["T03"] },
      { ...E5, id: "T05", deps: ["T04"] },
    ]);
    expect(r.passed["client-safe-rollout"]).toBe(true);
  });
});

describe("cross-repo-output switch task and forward references", () => {
  const sw = (task: Partial<T>): T[] => [O1, O2, { ...O3, ...task }, O4];

  test.each([
    [
      "placed in webshop, names ASSETS_BUCKET",
      {
        parts: ["webshop"],
        what: "Set `ASSETS_BUCKET` to `pm-example-webshop-media` in argocd's webshop deployment.",
      },
    ],
    [
      "possessive deployment, argocd part, names the new bucket",
      {
        parts: ["argocd/workloads/webshop"],
        what: "Point webshop's deployment at `pm-example-webshop-media`.",
      },
    ],
    [
      "argocd part, names the new bucket only",
      {
        parts: ["argocd/workloads/webshop"],
        what: "Switch webshop to `pm-example-webshop-media` and let Argo CD sync.",
      },
    ],
  ] as [string, Partial<T>][])("%s is the switch", async (_n, task) => {
    const r = await output(sw(task));
    expect(r.passed["consumer-covered"]).toBe(true);
    expect(r.passed["switch-order"]).toBe(true);
  });

  test("a hedged check of the deployment is not the switch", async () => {
    const r = await output(
      sw({
        parts: ["argocd/workloads/webshop"],
        what: "Check argocd's webshop deployment for references to the old bucket.",
      }),
    );
    expect(r.passed["consumer-covered"]).toBe(false);
  });

  test("an infra copy task that says before removing the old bucket is not a delete", async () => {
    const r = await output([
      O1,
      {
        id: "T02",
        parts: ["infra/envs/prod"],
        deps: ["T01"],
        what: "Copy every object from `pm-example-webshop-assets` to `pm-example-webshop-media` before removing the old bucket.",
      },
      O3,
      O4,
    ]);
    expect(r.passed["switch-order"]).toBe(true);
  });
});

describe("reposOf", () => {
  const doc = (what: string, parts: string[] = []) =>
    ({
      id: "T01",
      frontmatter: { title: "x", parts },
      body: `## What to do\n\n${what}\n`,
    }) as never;
  const of = (what: string, parts?: string[]): Repo[] => reposOf(doc(what, parts));

  test("parts win over text", () => {
    expect(of("In orders, do it.", ["argocd/workloads/webshop"])).toEqual(["argocd"]);
  });
  test("negated and cross-referenced mentions are dropped", () => {
    expect(of("In orders, change it; webshop unaffected, no change to infra.")).toEqual(["orders"]);
    expect(of("In argocd, the same change as in orders.")).toEqual(["argocd"]);
  });
  test("repo-only paths place a task", () => {
    expect(of("Edit envs/prod/assets.tf.")).toEqual(["infra"]);
    expect(of("Bump newTag.")).toEqual(["argocd"]);
  });
});
