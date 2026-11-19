import { beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pmProcess } from "../../ci/e2e/pm";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cleanupFixture, type FixtureInfo } from "../fixture";
import { hashFixture } from "../hashes";
import {
  buildCrossRepoLinksFixture,
  CROSS_REPO_ENDPOINT_REQUEST,
  CROSS_REPO_OUTPUT_REQUEST,
  crossRepoEndpoint,
  crossRepoOutput,
} from "../scenarios/cross-repo-links";
import { CONTRACT_SENTENCE } from "../scenarios/types";
import { PM_TODAY } from "../skill-paths";

const TARGET_REPOS = ["webshop", "infra", "argocd", "orders"];
const TARGET_TREES: Record<string, string> = {
  webshop: "4d88d84fa27c39a732a74be1cfea4228401fe591",
  infra: "7f5dce1a19c5e19dbc2f0eb50979bf08ababd69c",
  argocd: "96e4411de7aa82732570eaf3444195ba1b7de2ce",
  orders: "1f2d57094944e2ae949a2c9ff5512aaca523b407",
};
const MESSAGES: Record<string, string> = {
  webshop: "feat: order history page",
  argocd: "chore(webshop): deployment settings",
  infra: "feat: assets bucket",
  orders: "chore(chart): service",
};
const LINK_TOKENS = [
  "total_cents",
  "ORDERS_URL",
  "ASSETS_BUCKET",
  "pm-example-webshop-assets",
  "account/orders",
];

async function built(): Promise<{ dir: string; info: FixtureInfo; ws: string }> {
  const dir = join(await makeTempDir("bench-xrl"), "fixture");
  const info = await buildCrossRepoLinksFixture(dir);
  return { dir, info, ws: `${dir}-pm-workspace` };
}

async function markdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true, recursive: true })) {
    const rel = join(e.parentPath, e.name);
    if (e.isFile() && e.name.endsWith(".md") && !rel.includes("/.git/")) out.push(rel);
  }
  return out;
}

describe("cross-repo-links fixture", () => {
  let fx: Awaited<ReturnType<typeof built>>;
  beforeAll(async () => {
    fx = await built();
  }, 180_000);

  test("the manager is on main, clean, with four available projects", async () => {
    const status = await pmProcess(fx.dir, ["status"], { env: { PM_TODAY } });
    expect(status.code).toBe(0);
    const projects = status.stdout
      .split("\n")
      .filter((l) => new RegExp(`^ {2}(${TARGET_REPOS.join("|")}) {2}`).test(l));
    expect(projects).toHaveLength(4);
    expect(projects.every((l) => l.endsWith("  available"))).toBe(true);
    expect((await pmProcess(fx.dir, ["check"], { env: { PM_TODAY } })).code).toBe(0);
    expect((await gitOk(["status", "--porcelain"], fx.dir)).trim()).toBe("");
    expect(fx.info.epicSlugsBefore).toEqual([]);
  });

  test("the target trees are the ones the rubric records", async () => {
    // hashFixture covers only the manager, so the targets' content is pinned here and in RUBRIC.md.
    const trees: Record<string, string> = {};
    for (const repo of TARGET_REPOS) {
      trees[repo] = (await gitOk(["rev-parse", "HEAD^{tree}"], join(fx.ws, repo))).trim();
    }
    expect(trees).toEqual(TARGET_TREES);
  });

  test("each overlay commit is the last in its repo, neutral, and nothing is untracked", async () => {
    for (const repo of TARGET_REPOS) {
      const path = join(fx.ws, repo);
      expect([repo, (await gitOk(["log", "-1", "--format=%s", "HEAD"], path)).trim()]).toEqual([
        repo,
        MESSAGES[repo],
      ]);
      expect([repo, (await gitOk(["status", "--porcelain"], path)).trim()]).toEqual([repo, ""]);
    }
  });

  test("the links are in source and config", async () => {
    const read = (p: string) => readFile(join(fx.ws, p), "utf8");
    const history = await read("webshop/history.go");
    expect(history).toContain('json:"total_cents"');
    expect(history).toContain("/orders");
    const deployment = await read("argocd/workloads/webshop/deployment.yaml");
    expect(deployment).toContain("pm-example-webshop-assets");
    expect(deployment).toContain("http://orders.orders.svc.cluster.local:8080");
    const assets = await read("infra/envs/prod/assets.tf");
    expect(assets).toContain('bucket = "pm-example-webshop-assets"');
    expect(assets).toContain('output "webshop_assets_bucket"');
  });

  test("no doc names either link", async () => {
    const roots = [...TARGET_REPOS.map((r) => join(fx.ws, r)), join(fx.dir, "docs")];
    for (const root of roots) {
      for (const file of await markdownFiles(root)) {
        const text = await readFile(file, "utf8");
        for (const token of LINK_TOKENS)
          expect([file, text.includes(token)]).toEqual([file, false]);
      }
    }
  });

  test("the skill arm gets profiles", async () => {
    const withSkill = await crossRepoEndpoint.prepareCondition?.(fx.dir, "with-skill", fx.info);
    expect(await readFile(join(fx.dir, "docs/pm/projects/webshop.md"), "utf8")).toContain(
      "<!-- pm:parts:start -->",
    );
    expect(withSkill?.baselineSha).toBe((await gitOk(["rev-parse", "HEAD"], fx.dir)).trim());
  }, 120_000);
});

describe("cross-repo-links builds", () => {
  test("two builds give the same hash and target commits; cleanup leaves nothing", async () => {
    const a = await built();
    const b = await built();
    expect(await hashFixture(a.dir)).toBe(await hashFixture(b.dir));
    for (const repo of TARGET_REPOS) {
      const head = (ws: string) => gitOk(["rev-parse", "HEAD"], join(ws, repo));
      expect([repo, await head(a.ws)]).toEqual([repo, await head(b.ws)]);
    }
    await cleanupFixture(a.dir);
    const left = (await readdir(dirname(a.dir))).filter((n) => n.startsWith(basename(a.dir)));
    expect(left).toEqual([]);
  }, 360_000);
});

describe("cross-repo-links scenarios", () => {
  const strip = (request: string) => request.slice(0, -CONTRACT_SENTENCE.length);

  test("the endpoint request gives nothing away", () => {
    expect(CROSS_REPO_ENDPOINT_REQUEST.endsWith(CONTRACT_SENTENCE)).toBe(true);
    const request = strip(CROSS_REPO_ENDPOINT_REQUEST);
    for (const s of ["GET /orders", "total_cents", "amount_cents", "currency", "EUR"]) {
      expect([s, request.includes(s)]).toEqual([s, true]);
    }
    expect(request).not.toMatch(/webshop|argocd|ORDERS_URL|account\/orders|client|pmanager/i);
  });

  test("the output request gives nothing away", () => {
    expect(CROSS_REPO_OUTPUT_REQUEST.endsWith(CONTRACT_SENTENCE)).toBe(true);
    const request = strip(CROSS_REPO_OUTPUT_REQUEST);
    for (const s of [
      "pm-example-webshop-assets",
      "pm-example-webshop-media",
      "versioning",
      "90 days",
    ]) {
      expect([s, request.includes(s)]).toEqual([s, true]);
    }
    expect(request).not.toMatch(
      /argocd|ASSETS_BUCKET|deployment|workloads|kustomiz|\benv\b|pmanager/i,
    );
  });

  test("both scenarios run offline with their own check set", () => {
    for (const s of [crossRepoEndpoint, crossRepoOutput]) expect(s.offline).toBe(true);
    const ids = (s: typeof crossRepoEndpoint) => s.checks.map((c) => c.id);
    expect(ids(crossRepoEndpoint)).toEqual(
      expect.arrayContaining(["client-covered", "client-safe-rollout"]),
    );
    expect(ids(crossRepoOutput)).toEqual(
      expect.arrayContaining(["consumer-covered", "switch-order"]),
    );
  });
});
