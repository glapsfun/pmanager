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

describe("plan wordings from the final review", () => {
  const rollout = async (tasks: T[]) => (await grade(tasks)).passed["rollout-order"];

  test("a producer that names its consumer's file is not judged as the consumer (A, C)", async () => {
    const bucket = {
      ...BUCKET,
      what: `${BUCKET.what} The chart reads it in deploy/chart/values.yaml (T04).`,
    };
    expect(await rollout([bucket, WRITER, RELEASE, ROLLOUT])).toBe(true);
    const release = { ...RELEASE, what: `${RELEASE.what} T04 then moves image.tag to it.` };
    expect(await rollout([BUCKET, WRITER, release, ROLLOUT])).toBe(true);
  });

  test("one task that makes a link's both ends satisfies that link (D)", async () => {
    const value: T = {
      id: "T04",
      title: "Pass the exports bucket to the chart",
      deps: ["T01"],
      what: "In deploy/chart/values.yaml add exports.bucket and pass EXPORTS_BUCKET in templates/deployment.yaml.",
      accept: "`helm unittest deploy/chart` passes",
    };
    const releaseAndTag: T = {
      id: "T05",
      title: "Release 1.5.0 and roll it out",
      deps: ["T02"],
      what: "Run make release with VERSION 1.5.0, then set image.tag to 1.5.0 in deploy/chart/values.yaml.",
      accept: "`ct lint --charts deploy/chart` passes",
    };
    expect(await rollout([BUCKET, WRITER, value, releaseAndTag])).toBe(true);
  });

  test("a bucket value under another key still counts as the bucket value (E)", async () => {
    const chart = {
      ...ROLLOUT,
      what: "In deploy/chart/values.yaml add storage.exportsBucket and pass EXPORTS_BUCKET in templates/deployment.yaml; set image.tag to 1.5.0.",
    };
    expect(await rollout([BUCKET, WRITER, RELEASE, chart])).toBe(true);
    expect(await rollout([BUCKET, WRITER, RELEASE, { ...chart, deps: ["T03"] }])).toBe(false);
  });

  test("a bucket named as a resource creates the bucket (F)", async () => {
    const storage = {
      ...BUCKET,
      title: "Add exports storage",
      what: "In infra/terraform/, add aws_s3_bucket.exports with a 30-day aws_s3_bucket_lifecycle_configuration and an exports_bucket_name output.",
    };
    expect((await grade([storage, WRITER, RELEASE, ROLLOUT])).passed["resource-home"]).toBe(true);
  });

  test("moving the image or bumping the tag sets the image tag (G, Q)", async () => {
    const move = {
      ...ROLLOUT,
      what: "In deploy/chart/values.yaml set exports.bucket from the exports_bucket_name output and move the image to 1.5.0.",
    };
    expect(await rollout([BUCKET, WRITER, RELEASE, { ...move, deps: ["T01"] }])).toBe(false);
    expect(await rollout([BUCKET, WRITER, RELEASE, move])).toBe(true);
    const bump = {
      ...ROLLOUT,
      title: "Bump the tag in the orders Helm chart",
      what: "Set it to 1.5.0 and add the exports bucket value.",
    };
    expect(await rollout([BUCKET, WRITER, RELEASE, { ...bump, deps: ["T01"] }])).toBe(false);
    expect(await rollout([BUCKET, WRITER, RELEASE, bump])).toBe(true);
  });

  test("tagging v1.5.0 and pushing the image is the release (H)", async () => {
    const cut = {
      ...RELEASE,
      title: "Cut 1.5.0",
      what: "Bump VERSION in the Makefile to 1.5.0, tag v1.5.0 and push the image.",
    };
    expect(await rollout([BUCKET, WRITER, cut, ROLLOUT])).toBe(true);
  });

  test("a release mentioned in passing is not a release task (I)", async () => {
    const writer = { ...WRITER, what: `${WRITER.what} Ships in the 1.5.0 release.` };
    expect(await rollout([BUCKET, writer, { ...ROLLOUT, deps: ["T01", "T02"] }])).toBe(false);
  });

  test("a chart task that says where the tag comes from still borrows make test (O, P)", async () => {
    const borrow = async (what: string, accept: string) =>
      (await grade([BUCKET, WRITER, RELEASE, { ...ROLLOUT, what, accept }])).passed[
        "no-borrowed-checks"
      ];
    expect(
      await borrow(
        "In deploy/chart/values.yaml set exports.bucket from the exports_bucket_name output and image.tag to the version `make release` pushed.",
        "`make test` and `make lint` pass",
      ),
    ).toBe(false);
    expect(
      await borrow(
        "In deploy/chart/values.yaml set exports.bucket and point the image at ghcr.io/pm-example/orders:1.5.0 (image.tag).",
        "`make test` passes",
      ),
    ).toBe(false);
  });

  test("'not the infra repo' and an infra task that only reaches the bucket keep resource-home (J, V)", async () => {
    const own = {
      ...BUCKET,
      title: "Add the exports bucket to the orders Terraform",
      what: "Add the exports bucket and its output in the orders Terraform, not the infra repo.",
    };
    const j = await grade([own, WRITER, RELEASE, ROLLOUT]);
    expect(j.passed["resource-home"]).toBe(true);
    expect(j.passed["own-checks-terraform"]).toBe(true);
    const egress: T = {
      id: "T05",
      title: "Let the cluster nodes reach the exports bucket",
      what: "In the infra repo, open egress from modules/network to S3 so the orders pods reach the exports bucket.",
      accept: "`terraform validate` passes",
    };
    expect((await grade([...GOOD, egress])).passed["resource-home"]).toBe(true);
  });
});

describe("grader version 2, from the multi-stack-repo-cold-2 hand audit", () => {
  const unitOnly = { ...WRITER, accept: "unit tests cover the writer" };

  test("a test task that cites the chart's tests as a pattern is a service task (p1 T10)", async () => {
    const e2e: T = {
      id: "T05",
      title: "End-to-end test for the export happy path",
      deps: ["T04"],
      what: "Add an integration test (in CI, following whatever pattern `deploy/chart/tests/deployment_test.yaml` or the existing `make test` setup uses) that calls POST /orders/export and downloads the CSV.",
      accept: "Test runs as part of `make test` or an equivalent CI step",
    };
    const { passed } = await grade([BUCKET, unitOnly, RELEASE, ROLLOUT, e2e]);
    expect(passed["no-borrowed-checks"]).toBe(true);
    expect(passed["own-checks-service"]).toBe(true);
  });

  test("an unplaced test task that names make test is a service task (p8 T06)", async () => {
    const e2e: T = {
      id: "T05",
      title: "End-to-end integration test for the export flow",
      deps: ["T04"],
      what: "Call the request endpoint, poll the status endpoint until ready, then call the download endpoint and parse the CSV.",
      accept: "The test runs in CI (`make test` or the project's existing test command)",
    };
    expect(
      (await grade([BUCKET, unitOnly, RELEASE, ROLLOUT, e2e])).passed["own-checks-service"],
    ).toBe(true);
  });

  test("bumping the image version through the Makefile's release target releases and sets the tag (p2 T10)", async () => {
    const deploy: T = {
      id: "T04",
      title: "Deploy: Helm chart, rollout and docs",
      deps: ["T01", "T02"],
      what: "Add `storage.exportBucket` to `deploy/chart/values.yaml` and an `EXPORT_BUCKET` env var to `templates/deployment.yaml`, bump the chart/image version per the existing release process (`Makefile`'s `release` target).",
      accept: "`helm unittest deploy/chart` passes",
    };
    expect((await grade([BUCKET, WRITER, deploy])).passed["rollout-order"]).toBe(true);
  });
});
