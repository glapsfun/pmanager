import { describe, expect, test } from "bun:test";
import { cp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  buildHandoff,
  loadLocalRepoMap,
  parseLocalRepoMap,
  readLocalRepoMap,
  resolveRepo,
} from "../scripts/handoff";
import { extractProfile, type Profile } from "../scripts/profile";
import { loadPmRepo } from "../scripts/repo";
import { copyFixture, gitOk, initGitRepo, makeTempDir, writeTree } from "./helpers";

async function fixture() {
  const root = await makeTempDir("handoff");
  await copyFixture(root);
  return { root, repo: await loadPmRepo(root) };
}

const WEBSHOP = "git@github.com:glapsfun/webshop.git";

describe("local repo map", () => {
  test("creates the map and a self-ignoring .gitignore on first use", async () => {
    const { repo } = await fixture();
    const map = await loadLocalRepoMap(repo.pmDir);
    expect(map).toEqual({});
    expect(await readFile(join(repo.pmDir, ".local", "repos.json"), "utf8")).toBe("{}\n");
    expect(await readFile(join(repo.pmDir, ".local", ".gitignore"), "utf8")).toBe("*\n");
  });
  test("reads an existing map; resolveRepo", async () => {
    const { repo } = await fixture();
    await Bun.write(
      join(repo.pmDir, ".local", "repos.json"),
      JSON.stringify({ [WEBSHOP]: "/srv/webshop" }),
    );
    const map = await loadLocalRepoMap(repo.pmDir);
    expect(resolveRepo(WEBSHOP, map)).toBe("/srv/webshop");
    expect(resolveRepo("git@github.com:other/x.git", map)).toBeNull();
  });
});

describe("buildHandoff", () => {
  test("contains every section and the report-back sentence", async () => {
    const { repo } = await fixture();
    const brief = buildHandoff(repo, "app-performance", "T03", { [WEBSHOP]: "/srv/webshop" });
    expect(
      brief.startsWith("# Handoff — Fix orders page latency / T03 — Batch item queries\n"),
    ).toBe(true);
    expect(brief).toContain("## Epic\n\nThe /orders page returns every order");
    expect(brief).toContain(`- ${WEBSHOP} → /srv/webshop`);
    expect(brief).toContain(
      "## Task file: docs/pm/app-performance/tasks/T03-batch-item-queries.md\n",
    );
    expect(brief).toContain("id: T03\n");
    expect(brief).toContain("## Acceptance criteria\n\n- [ ] /orders issues O(1) queries");
    expect(brief).toContain("## Out of scope\n\n- Pagination (T04).");
    expect(brief).toContain('"T03 of app-performance is done, evidence at <path>"');
  });
  test("report back offers done with fixed by, a failed attempt, and blocked", async () => {
    const { repo } = await fixture();
    const brief = buildHandoff(repo, "app-performance", "T03", {});
    expect(brief).toContain(
      '"T03 of app-performance is done, evidence at <path>"; after a failed attempt, end it with "; fixed by <what changed>"',
    );
    expect(brief).toContain(
      'If an attempt failed: "T03 of app-performance attempt failed: tried <what>; got <result>; evidence at <path>"',
    );
    expect(brief).toContain('If blocked: "T03 of app-performance is blocked on <reason>"');
    expect(brief).toContain(
      "Keep each field to a short summary and point at evidence by path or URL; never paste log output.",
    );
  });
  test("unmapped repo is reported, not resolved", async () => {
    const { repo } = await fixture();
    const brief = buildHandoff(repo, "app-performance", "T01", {});
    expect(brief).toContain(
      "→ not checked out on this machine; map it in docs/pm/.local/repos.json",
    );
  });
  test("throws on unknown epic or task", async () => {
    const { repo } = await fixture();
    expect(() => buildHandoff(repo, "nope", "T01", {})).toThrow("unknown epic nope");
    expect(() => buildHandoff(repo, "app-performance", "T99", {})).toThrow(
      "unknown task T99 in app-performance",
    );
  });
});

describe("repo map, read-only", () => {
  test("parseLocalRepoMap keeps string values only", () => {
    expect(parseLocalRepoMap('{"a/b": "/x", "n": 3, "arr": []}')).toEqual({ "a/b": "/x" });
    expect(parseLocalRepoMap("[]")).toEqual({});
  });
  test("readLocalRepoMap returns {} and writes nothing when the map is missing", async () => {
    const root = await makeTempDir("repomap");
    const pmDir = join(root, "docs/pm");
    expect(await readLocalRepoMap(pmDir)).toEqual({});
    await expect(stat(join(pmDir, ".local"))).rejects.toThrow();
  });
  test("readLocalRepoMap reads an existing map", async () => {
    const root = await makeTempDir("repomap");
    await writeTree(root, {
      "docs/pm/.local/repos.json": '{"glapsfun/webshop": "/tmp/webshop"}\n',
    });
    expect(await readLocalRepoMap(join(root, "docs/pm"))).toEqual({
      "glapsfun/webshop": "/tmp/webshop",
    });
  });
});

const ORDERS_FIXTURE = join(import.meta.dir, "../../../../../bench/scenarios/fixtures/orders");

async function ordersProfiles(): Promise<Map<string, Profile>> {
  const dir = await makeTempDir("handoff-orders");
  await cp(ORDERS_FIXTURE, dir, { recursive: true });
  await initGitRepo(dir);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", "seed"], dir);
  return new Map([["orders", await extractProfile(dir)]]);
}

/** The fixture with T01 naming the given parts. */
async function withParts(parts: string) {
  const { root } = await fixture();
  const file = join(root, "docs/pm/app-performance/tasks/T01-benchmark-orders.md");
  const raw = await readFile(file, "utf8");
  await writeTree(root, {
    "docs/pm/app-performance/tasks/T01-benchmark-orders.md": raw.replace(
      "depends-on: []",
      `depends-on: []\nparts: ${parts}`,
    ),
  });
  return loadPmRepo(root);
}

describe("buildHandoff with parts", () => {
  test("the brief lists the named part's checks, deploy and forbidden commands", async () => {
    const repo = await withParts("[orders/infra/terraform]");
    const brief = buildHandoff(repo, "app-performance", "T01", {}, await ordersProfiles());
    const section = brief.slice(brief.indexOf("## Checks for this task's parts"));
    expect(section).toContain("`orders/infra/terraform`");
    expect(section).toMatch(/checks: .*\.\/scripts\/tf-check\.sh/);
    expect(section).toMatch(/do not run: .*terraform apply/);
  });

  test("the brief lists the links that touch the part", async () => {
    const repo = await withParts("[orders/deploy/chart]");
    const brief = buildHandoff(repo, "app-performance", "T01", {}, await ordersProfiles());
    expect(brief).toContain("storage.bucket follows infra/terraform/main.tf");
    expect(brief).toContain("image.tag follows Makefile VERSION");
  });

  test("a task without parts gets no section; an unknown part is named, not dropped", async () => {
    const { repo } = await fixture();
    expect(buildHandoff(repo, "app-performance", "T01", {}, await ordersProfiles())).not.toContain(
      "## Checks for this task's parts",
    );
    const odd = await withParts("[orders/nope]");
    expect(buildHandoff(odd, "app-performance", "T01", {}, await ordersProfiles())).toContain(
      "`orders/nope`: no such part in a stored profile",
    );
  });
});

describe("final review: handoff size", () => {
  test("I1: links per part are capped", async () => {
    const repo = await withParts("[orders/deploy/chart]");
    const base = (await ordersProfiles()).get("orders") as Profile;
    const end = (folder: string, i: number) => ({
      folder,
      file: `${folder}/f${i}`,
      line: 1,
      key: `k${i}`,
    });
    const links = Array.from({ length: 12 }, (_, i) => ({
      value: `value-${i}`,
      source: end("infra/terraform", i),
      consumer: end("deploy/chart", i),
      release: false,
    }));
    const brief = buildHandoff(
      repo,
      "app-performance",
      "T01",
      {},
      new Map([["orders", { ...base, links }]]),
    );
    expect(brief.match(/^ {2}- link:/gm)?.length).toBe(5);
    expect(brief).toContain("7 more links");
  });
});
