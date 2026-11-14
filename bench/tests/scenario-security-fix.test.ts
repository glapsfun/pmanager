import { beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pmProcess } from "../../ci/e2e/pm";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { cleanupFixture, type FixtureInfo } from "../fixture";
import { hashFixture } from "../hashes";
import {
  buildSecurityFixFixture,
  SECURITY_FIX_REQUEST,
  securityFix,
} from "../scenarios/security-fix";
import { BASE_IMAGE, FINDINGS, PARENTS } from "../scenarios/security-fix-facts";
import { CONTRACT_SENTENCE } from "../scenarios/types";
import { PM_TODAY } from "../skill-paths";

const TARGET_REPOS = ["webshop", "infra", "argocd", "orders", "storefront", "worker"];
const TARGET_TREES: Record<string, string> = {
  orders: "83576bd3f11c391c95b3c93f15b282bd4d2a9ec7",
  webshop: "cc1efee07550324e410d84679d19b803144b0359",
  argocd: "d9e5a06ca2eaae0f4477aaa4da820d789ff99734",
  storefront: "b421cdaa132e8d7262177b9cfb44b4995a11b53e",
  worker: "8d6fbb1b2259420e5cc75e57ec5767d4b7ad9012",
};

async function built(): Promise<{ dir: string; info: FixtureInfo; ws: string }> {
  const dir = join(await makeTempDir("bench-sec"), "fixture");
  const info = await buildSecurityFixFixture(dir);
  return { dir, info, ws: `${dir}-pm-workspace` };
}

describe("security-fix fixture", () => {
  let fx: Awaited<ReturnType<typeof built>>;
  beforeAll(async () => {
    fx = await built();
  }, 180_000);

  test("the manager is on main, clean, with six available projects", async () => {
    const status = await pmProcess(fx.dir, ["status"], { env: { PM_TODAY } });
    expect(status.code).toBe(0);
    const projects = status.stdout
      .split("\n")
      .filter((l) => new RegExp(`^ {2}(${TARGET_REPOS.join("|")}) {2}`).test(l));
    expect(projects).toHaveLength(6);
    expect(projects.every((l) => l.endsWith("  available"))).toBe(true);
    expect((await pmProcess(fx.dir, ["check"], { env: { PM_TODAY } })).code).toBe(0);
    expect((await gitOk(["status", "--porcelain"], fx.dir)).trim()).toBe("");
    expect(fx.info.epicSlugsBefore).toEqual([]);
  });

  test("the target trees are the ones the experiment's rubric records", async () => {
    // hashFixture covers only the manager, so the targets' content is pinned here and in RUBRIC.md.
    const trees: Record<string, string> = {};
    for (const repo of Object.keys(TARGET_TREES)) {
      trees[repo] = (await gitOk(["rev-parse", "HEAD^{tree}"], join(fx.ws, repo))).trim();
    }
    expect(trees).toEqual(TARGET_TREES);
  });

  test("the overlay is committed in each target it touches, and nothing is left untracked", async () => {
    for (const repo of ["orders", "webshop", "argocd", "storefront", "worker"]) {
      const path = join(fx.ws, repo);
      expect([repo, (await gitOk(["status", "--porcelain"], path)).trim()]).toEqual([repo, ""]);
    }
    expect(await readFile(join(fx.ws, "orders/go.mod"), "utf8")).toContain("golang.org/x/net");
    expect(await readFile(join(fx.ws, "storefront/Dockerfile"), "utf8")).toContain(
      BASE_IMAGE.image,
    );
  });

  test("the skill arms get profiles, the no-skill arm none", async () => {
    const storefront = () => readFile(join(fx.dir, "docs/pm/projects/storefront.md"), "utf8");
    expect(await securityFix.prepareCondition?.(fx.dir, "without-skill", fx.info)).toEqual(fx.info);
    expect(await storefront()).not.toContain("<!-- pm:parts:start -->");
    const withSkill = await securityFix.prepareCondition?.(fx.dir, "with-skill", fx.info);
    expect(await storefront()).toContain("<!-- pm:parts:start -->");
    expect((await gitOk(["status", "--porcelain"], fx.dir)).trim()).toBe("");
    expect(withSkill?.baselineSha).toBe((await gitOk(["rev-parse", "HEAD"], fx.dir)).trim());
  }, 120_000);
});

describe("security-fix builds", () => {
  test("two builds hash the same and give the same target commits; cleanup leaves nothing", async () => {
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

describe("security-fix scenario", () => {
  test("the request names the four findings and gives nothing away", () => {
    expect(SECURITY_FIX_REQUEST.endsWith(CONTRACT_SENTENCE)).toBe(true);
    const request = SECURITY_FIX_REQUEST.slice(0, -CONTRACT_SENTENCE.length);
    for (const f of FINDINGS) {
      for (const s of [f.advisory, f.pkg, f.fixed, f.named]) {
        expect([f.key, s, request.includes(s)]).toEqual([f.key, s, true]);
      }
    }
    expect(request).toContain(BASE_IMAGE.image);
    expect(request).not.toMatch(
      /webshop|argocd|kustomiz|values\.ya?ml|image\.tag|deploy|release|go\.sum|uv\.lock|package-lock|pmanager/i,
    );
    for (const p of PARENTS) expect([p.pkg, request.includes(p.pkg)]).toEqual([p.pkg, false]);
    expect(request).not.toMatch(/\bexpress\b|gorilla|websocket/i);
  });

  test("the scenario runs offline", () => {
    expect(securityFix.offline).toBe(true);
  });
});
