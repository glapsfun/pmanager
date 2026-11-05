import { beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pmProcess } from "../../ci/e2e/pm";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cleanupFixture, type FixtureInfo } from "../fixture";
import { hashFixture } from "../hashes";
import { MULTI_REPO_REQUEST, multiRepoContext } from "../scenarios/multi-repo-context";
import {
  buildMultiRepoContextAsIsFixture,
  multiRepoContextAsIs,
} from "../scenarios/multi-repo-context-asis";
import { MEASUREMENT_SCENARIOS, SCENARIOS } from "../scenarios/registry";
import { PM_TODAY } from "../skill-paths";

// The whole example story is replayed through pm, which can outlast the default 5 s test timeout.
const BUILD_MS = 60_000;

async function built(): Promise<{ dir: string; info: FixtureInfo }> {
  const dir = join(await makeTempDir("bench-mrc-asis"), "fixture");
  return { dir, info: await buildMultiRepoContextAsIsFixture(dir) };
}

describe("multi-repo-context-asis fixture", () => {
  let first: { dir: string; info: FixtureInfo };
  beforeAll(async () => {
    first = await built();
  }, BUILD_MS);

  test("the manager holds the whole story: four epics, three available projects, a clean pushed main", async () => {
    const { dir, info } = first;
    const status = await pmProcess(dir, ["status"], { env: { PM_TODAY } });
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/webshop-healthcheck\s+feature\s+done/);
    expect(status.stdout).toMatch(/staging-environment\s+feature\s+in-progress/);
    expect(status.stdout).toMatch(/argocd-sso-dex[\s\S]*?\[stale\]/);
    expect(status.stdout).toMatch(/multi-region-failover\s+initiative\s+abandoned/);
    const projects = status.stdout
      .split("\n")
      .filter((l) => /^ {2}(webshop|infra|argocd) {2}/.test(l));
    expect(projects).toHaveLength(3);
    expect(projects.every((l) => l.endsWith("  available"))).toBe(true);
    expect((await pmProcess(dir, ["check"], { env: { PM_TODAY } })).code).toBe(0);
    expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
    expect((await gitOk(["rev-list", "--count", "origin/main..main"], dir)).trim()).toBe("0");
    expect(info.epicSlugsBefore).toEqual(["webshop-healthcheck"]);
  });

  // Infra's conventions reach the memo only on the staging epic's branch, so main's memo lacks them.
  test("main's memo is the story's own: webshop and argocd checks and the release order", async () => {
    const memo = await readFile(join(first.dir, "docs/pm/pmanager-memo.md"), "utf8");
    expect(memo).toContain("a release reaches the cluster only when `newTag` is bumped");
    expect(memo).toContain("make test");
    expect(memo).toContain("kubeconform");
  });

  test(
    "two builds hash the same, and cleanup leaves nothing behind",
    async () => {
      const second = await built();
      expect(await hashFixture(second.dir)).toBe(await hashFixture(first.dir));
      await cleanupFixture(second.dir);
      const left = (await readdir(dirname(second.dir))).filter((n) =>
        n.startsWith(basename(second.dir)),
      );
      expect(left).toEqual([]);
    },
    BUILD_MS,
  );
});

describe("multi-repo-context-asis scenario", () => {
  test("asks the cold scenario's request and grades it with the same checks", () => {
    expect(multiRepoContextAsIs.task).toBe(MULTI_REPO_REQUEST);
    expect(multiRepoContextAsIs.graderVersion).toBe(multiRepoContext.graderVersion);
    expect(multiRepoContextAsIs.checks.map((c) => c.id)).toEqual(
      multiRepoContext.checks.map((c) => c.id),
    );
  });

  test("is a measurement scenario, never run by the release e2e", () => {
    expect(SCENARIOS.map((s) => s.name)).not.toContain("multi-repo-context-asis");
    expect(MEASUREMENT_SCENARIOS.map((s) => s.name)).toContain("multi-repo-context-asis");
  });
});
