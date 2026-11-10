import { beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pmProcess } from "../../ci/e2e/pm";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cleanupFixture, type FixtureInfo } from "../fixture";
import { hashFixture } from "../hashes";
import { buildMultiStackRepoFixture, MULTI_STACK_REQUEST } from "../scenarios/multi-stack-repo";
import { CONTRACT_SENTENCE } from "../scenarios/types";
import { PM_TODAY } from "../skill-paths";

async function built(): Promise<{ dir: string; info: FixtureInfo; orders: string }> {
  const dir = join(await makeTempDir("bench-msr"), "fixture");
  const info = await buildMultiStackRepoFixture(dir);
  return { dir, info, orders: `${dir}-pm-workspace/orders` };
}

/** Every tracked file of the orders repo, by its path in the repo. */
async function trackedFiles(repo: string): Promise<Record<string, string>> {
  const paths = (await gitOk(["ls-files"], repo)).trim().split("\n");
  const out: Record<string, string> = {};
  for (const p of paths) out[p] = await readFile(join(repo, p), "utf8");
  return out;
}

function holding(files: Record<string, string>, re: RegExp): string[] {
  return Object.keys(files)
    .filter((p) => re.test(files[p] ?? ""))
    .sort();
}

describe("multi-stack-repo fixture", () => {
  let fx: Awaited<ReturnType<typeof built>>;
  let files: Record<string, string>;
  beforeAll(async () => {
    fx = await built();
    files = await trackedFiles(fx.orders);
  }, 120_000);

  test("the manager is on main, clean, with four available projects", async () => {
    const status = await pmProcess(fx.dir, ["status"], { env: { PM_TODAY } });
    expect(status.code).toBe(0);
    const projects = status.stdout
      .split("\n")
      .filter((l) => /^ {2}(webshop|infra|argocd|orders) {2}/.test(l));
    expect(projects).toHaveLength(4);
    expect(projects.every((l) => l.endsWith("  available"))).toBe(true);
    expect((await pmProcess(fx.dir, ["check"], { env: { PM_TODAY } })).code).toBe(0);
    expect((await gitOk(["status", "--porcelain"], fx.dir)).trim()).toBe("");
    expect(fx.info.epicSlugsBefore).toEqual([]);
  });

  test("each part's commands live only in that part's own file", () => {
    expect(holding(files, /tf-check|checkov/)).toEqual([
      "infra/terraform/AGENTS.md",
      "infra/terraform/scripts/tf-check.sh",
    ]);
    expect(holding(files, /helm unittest|ct lint/)).toEqual([".github/workflows/chart.yml"]);
    const readme = files["README.md"] ?? "";
    expect(readme).toContain("make test");
    expect(readme).toContain("infra/terraform/");
    expect(readme).toContain("deploy/chart/");
    expect(readme).not.toMatch(
      /tf-check|checkov|helm (?:unittest|lint)|ct lint|tflint|terraform (?:fmt|validate)|bucket|image\.tag/i,
    );
  });

  test("the two links exist and no file states them", () => {
    const values = files["deploy/chart/values.yaml"] ?? "";
    const bucket = /bucket = "([^"]+)"/.exec(files["infra/terraform/main.tf"] ?? "")?.[1];
    expect(bucket).toBeTruthy();
    expect(/^ {2}bucket: (\S+)$/m.exec(values)?.[1]).toBe(bucket);
    const version = /^VERSION := (\S+)$/m.exec(files.Makefile ?? "")?.[1];
    expect(version).toBeTruthy();
    expect(/^ {2}tag: "([^"]+)"$/m.exec(values)?.[1]).toBe(version);
    expect(holding(files, /orders_bucket_name/)).toEqual(["infra/terraform/outputs.tf"]);
    const chart = Object.keys(files).filter((p) => p.startsWith("deploy/chart/"));
    expect(chart.length).toBeGreaterThan(0);
    expect(chart.filter((p) => /terraform|outputs\.tf/i.test(files[p] ?? ""))).toEqual([]);
    for (const p of ["Makefile", ".github/workflows/service.yml"]) {
      expect([p, /values\.ya?ml|deploy\/chart|image\.tag/.test(files[p] ?? "")]).toEqual([
        p,
        false,
      ]);
    }
  });
});

describe("multi-stack-repo builds", () => {
  test("two builds hash the same and give the same orders commit; cleanup leaves nothing", async () => {
    const a = await built();
    const b = await built();
    expect(await hashFixture(a.dir)).toBe(await hashFixture(b.dir));
    const head = (repo: string) => gitOk(["rev-parse", "HEAD"], repo);
    expect(await head(a.orders)).toBe(await head(b.orders));
    await cleanupFixture(a.dir);
    const left = (await readdir(dirname(a.dir))).filter((n) => n.startsWith(basename(a.dir)));
    expect(left).toEqual([]);
  }, 240_000);
});

describe("multi-stack-repo scenario", () => {
  test("the request names no part, folder, command, bucket, chart, release or order", () => {
    expect(MULTI_STACK_REQUEST.endsWith(CONTRACT_SENTENCE)).toBe(true);
    const request = MULTI_STACK_REQUEST.slice(0, -CONTRACT_SENTENCE.length);
    expect(request).toContain("export");
    expect(request).toContain("30 days");
    expect(request).not.toMatch(
      /terraform|helm|chart|bucket|\bmake\b|release|image|tag\b|deploy|infra|kubernetes|order of|before|after|pmanager/i,
    );
  });
});
