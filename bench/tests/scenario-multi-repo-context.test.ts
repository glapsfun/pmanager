import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pmProcess } from "../../ci/e2e/pm";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cleanupFixture } from "../fixture";
import { hashFixture } from "../hashes";
import { buildMultiRepoContextFixture, MULTI_REPO_REQUEST } from "../scenarios/multi-repo-context";
import { MEASUREMENT_SCENARIOS, SCENARIOS, scenarioByName } from "../scenarios/registry";
import { PM_TODAY } from "../skill-paths";

async function built() {
  const dir = join(await makeTempDir("bench-mrc"), "fixture");
  return { dir, info: await buildMultiRepoContextFixture(dir) };
}

const TARGET_FACTS =
  /make test|make lint|go test|golangci|terraform|tflint|yamllint|kubeconform|kubectl|newTag/;

describe("multi-repo-context fixture", () => {
  test("the manager is on main, clean, with three available projects and two claims", async () => {
    const { dir, info } = await built();
    const status = await pmProcess(dir, ["status"], { env: { PM_TODAY } });
    expect(status.code).toBe(0);
    const projects = status.stdout
      .split("\n")
      .filter((l) => /^ {2}(webshop|infra|argocd) {2}/.test(l));
    expect(projects).toHaveLength(3);
    expect(projects.every((l) => l.endsWith("  available"))).toBe(true);
    expect(status.stdout).toMatch(/argocd-sso-dex[\s\S]*?\[stale\]/);
    expect(status.stdout).toMatch(/multi-region-failover\s+initiative\s+abandoned/);
    expect((await pmProcess(dir, ["check"], { env: { PM_TODAY } })).code).toBe(0);
    expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
    expect(info.originBare?.endsWith("-pm-workspace/remotes/manager.git")).toBe(true);
    expect(info.epicSlugsBefore).toEqual([]);
  });

  test("the memo carries no target fact, only the manager's own convention", async () => {
    const { dir } = await built();
    const memo = await readFile(join(dir, "docs/pm/pmanager-memo.md"), "utf8");
    expect(memo).toContain("bun run lint");
    expect(memo).not.toMatch(TARGET_FACTS);
  });

  test("two builds hash the same, and cleanup leaves nothing behind", async () => {
    const a = await built();
    const b = await built();
    expect(await hashFixture(a.dir)).toBe(await hashFixture(b.dir));
    await cleanupFixture(a.dir);
    const left = (await readdir(dirname(a.dir))).filter((n) => n.startsWith(basename(a.dir)));
    expect(left).toEqual([]);
  });
});

describe("multi-repo-context scenario", () => {
  test("the request names no command, check, convention or pmanager", () => {
    expect(MULTI_REPO_REQUEST).toContain("load balancer");
    expect(MULTI_REPO_REQUEST).toContain("10%");
    expect(MULTI_REPO_REQUEST).not.toMatch(
      /\bmake\b|yamllint|kubeconform|terraform|tflint|kubectl|pmanager/i,
    );
  });

  test("is a measurement scenario, never run by the release e2e", () => {
    expect(scenarioByName("multi-repo-context")?.task).toBe(MULTI_REPO_REQUEST);
    expect(SCENARIOS.map((s) => s.name)).not.toContain("multi-repo-context");
    expect(MEASUREMENT_SCENARIOS.map((s) => s.name)).toContain("multi-repo-context");
  });
});
