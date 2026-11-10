import { describe, expect, test } from "bun:test";
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
import { multiStackRepoChecks, ORDERS_URL, partsOf } from "../graders/multi-stack-repo";
import { runChecks } from "../graders/types";

interface T {
  id: string;
  title: string;
  deps?: string[];
  what: string;
  accept: string;
}

const SLUG = "orders-exports";

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

Part of the exports epic.

## What to do

${t.what}

## Acceptance criteria

- [ ] ${t.accept}

## Out of scope

none

## Notes
`;
}

/** A repo holding one sample plan, as a run leaves it. */
async function planRepo(tasks: T[], repos: string[]): Promise<{ dir: string; base: string }> {
  const dir = await makeTempDir("msr-plan");
  await initGitRepo(dir);
  const base = await headSha(dir);
  const files: Record<string, string> = {
    [`docs/pm/${SLUG}/epic.md`]: `---\nid: ${SLUG}\ntitle: Order exports\ntype: feature\nstatus: draft\ncreated: 2026-09-15\nupdated: 2026-09-15\ncontract: 1\nrepos:\n${repos.map((u) => `  - ${u}`).join("\n")}\n---\n\n# Order exports\n`,
    [`docs/pm/${SLUG}/plan.md`]: `---\nepic: ${SLUG}\nstatus: draft\nupdated: 2026-09-15\ncontract: 1\n---\n\n# Plan\n\n## Milestones\n\n### M1: Exports written\n\n### M2: Exports live\n`,
  };
  for (const t of tasks) files[`docs/pm/${SLUG}/tasks/${t.id}-x.md`] = taskFile(t);
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "plan"], dir);
  return { dir, base };
}

async function grade(tasks: T[], repos: string[] = [ORDERS_URL]) {
  const { dir, base } = await planRepo(tasks, repos);
  const info = {
    baselineSha: base,
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [],
    initialDirty: {},
  };
  const ctx = await buildCheckContext(dir, info, EMPTY_TELEMETRY);
  const res = await runChecks(multiStackRepoChecks(), ctx);
  return {
    passed: Object.fromEntries(res.map((r) => [r.id, r.passed])),
    evidence: Object.fromEntries(res.map((r) => [r.id, r.evidence])),
  };
}

async function parts(what: string) {
  const { dir } = await planRepo([{ id: "T01", title: "A change", what, accept: "done" }], []);
  const task = (await loadPmRepo(dir)).epics[0]?.tasks[0];
  if (!task) throw new Error("sample task missing");
  return partsOf(task);
}

const BUCKET: T = {
  id: "T01",
  title: "Add the exports bucket",
  what: "In orders, add an aws_s3_bucket for exports in infra/terraform/ with an exports_bucket_name output.",
  accept: "`./scripts/tf-check.sh` passes",
};
const WRITER: T = {
  id: "T02",
  title: "Write exports from the service",
  what: "In internal/exports/, write the CSV to the bucket named by EXPORTS_BUCKET.",
  accept: "`make test` passes",
};
const RELEASE: T = {
  id: "T03",
  title: "Release orders 1.5.0",
  deps: ["T02"],
  what: "Run make release with VERSION 1.5.0 to push ghcr.io/pm-example/orders:1.5.0.",
  accept: "the image exists",
};
const ROLLOUT: T = {
  id: "T04",
  title: "Roll the chart out with exports",
  deps: ["T01", "T03"],
  what: "In deploy/chart/values.yaml set exports.bucket from the exports_bucket_name output and image.tag to 1.5.0.",
  accept: "`helm unittest deploy/chart` and `ct lint --charts deploy/chart` pass",
};
const GOOD = [BUCKET, WRITER, RELEASE, ROLLOUT];
const IDS = [
  "own-checks-service",
  "own-checks-terraform",
  "own-checks-chart",
  "no-borrowed-checks",
  "resource-home",
  "rollout-order",
  "repos-registered",
  "no-manager-commands",
];

describe("multi-stack-repo grader", () => {
  test("a plan that does everything right passes all eight", async () => {
    const { passed } = await grade(GOOD);
    expect(Object.keys(passed)).toEqual(IDS);
    for (const id of IDS) expect([id, passed[id]]).toEqual([id, true]);
  });

  test("terraform validate or tflint alone is not the terraform part's check", async () => {
    const bucket = { ...BUCKET, accept: "`terraform validate` and `tflint` pass" };
    expect((await grade([bucket, WRITER, RELEASE, ROLLOUT])).passed["own-checks-terraform"]).toBe(
      false,
    );
  });

  test("helm lint alone is not the chart part's check", async () => {
    const rollout = { ...ROLLOUT, accept: "`helm lint deploy/chart` passes" };
    expect((await grade([BUCKET, WRITER, RELEASE, rollout])).passed["own-checks-chart"]).toBe(
      false,
    );
  });

  test("a chart-only task that names make test borrows the service's check", async () => {
    const borrowed = { ...ROLLOUT, accept: "`make test` passes" };
    expect((await grade([BUCKET, WRITER, RELEASE, borrowed])).passed["no-borrowed-checks"]).toBe(
      false,
    );
    const both = {
      ...ROLLOUT,
      what: "In internal/exports/ read EXPORTS_BUCKET, and in deploy/chart/values.yaml set exports.bucket and image.tag to 1.5.0.",
      accept: "`make test` passes",
    };
    expect((await grade([BUCKET, WRITER, RELEASE, both])).passed["no-borrowed-checks"]).toBe(true);
  });

  test("a bucket in the shared infra repo fails resource-home and leaves own-checks-terraform ungraded", async () => {
    const shared = {
      ...BUCKET,
      what: "In the infra repo, add the exports bucket in modules/storage and envs/prod.",
    };
    const { passed } = await grade([shared, WRITER, RELEASE, ROLLOUT]);
    expect(passed["resource-home"]).toBe(false);
    expect(passed["own-checks-terraform"]).toBeNull();
  });

  test("the rollout waits for the bucket and the release", async () => {
    const noBucket = await grade([BUCKET, WRITER, RELEASE, { ...ROLLOUT, deps: ["T03"] }]);
    expect(noBucket.passed["rollout-order"]).toBe(false);
    expect(noBucket.evidence["rollout-order"]).toContain("bucket");
    const noRelease = await grade([BUCKET, WRITER, RELEASE, { ...ROLLOUT, deps: ["T01"] }]);
    expect(noRelease.passed["rollout-order"]).toBe(false);
    expect(noRelease.evidence["rollout-order"]).toContain("image");
  });

  test("split chart tasks are judged per link", async () => {
    const value: T = {
      id: "T04",
      title: "Pass the exports bucket to the service",
      deps: ["T01"],
      what: "In deploy/chart/values.yaml set exports.bucket from the exports_bucket_name output.",
      accept: "`helm unittest deploy/chart` passes",
    };
    const tag: T = {
      id: "T05",
      title: "Move the chart to 1.5.0",
      deps: ["T03"],
      what: "In deploy/chart/values.yaml set image.tag to 1.5.0.",
      accept: "`ct lint --charts deploy/chart` passes",
    };
    expect((await grade([BUCKET, WRITER, RELEASE, value, tag])).passed["rollout-order"]).toBe(true);
    const swapped = [
      BUCKET,
      WRITER,
      RELEASE,
      { ...value, deps: ["T03"] },
      { ...tag, deps: ["T01"] },
    ];
    expect((await grade(swapped)).passed["rollout-order"]).toBe(false);
  });

  test("a part named by words lands in that part", async () => {
    expect(await parts("Bump the image tag in the orders Helm chart.")).toEqual(["chart"]);
    expect(await parts("Add the bucket to the orders Terraform.")).toEqual(["terraform"]);
  });

  test("an image push or make release counts as the release", async () => {
    const push = {
      ...RELEASE,
      title: "Build the 1.5.0 image",
      what: "Push ghcr.io/pm-example/orders:1.5.0.",
    };
    expect((await grade([BUCKET, WRITER, push, ROLLOUT])).passed["rollout-order"]).toBe(true);
  });

  test("repos must name orders", async () => {
    const { passed } = await grade(GOOD, ["https://github.com/pm-example/webshop.git"]);
    expect(passed["repos-registered"]).toBe(false);
  });

  test("no task names the manager's bun commands", async () => {
    const writer = { ...WRITER, accept: "`bun test` passes" };
    expect((await grade([BUCKET, writer, RELEASE, ROLLOUT])).passed["no-manager-commands"]).toBe(
      false,
    );
  });
});
