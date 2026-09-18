import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  buildHandoff,
  loadLocalRepoMap,
  parseLocalRepoMap,
  readLocalRepoMap,
  resolveRepo,
} from "../scripts/handoff";
import { loadPmRepo } from "../scripts/repo";
import { copyFixture, makeTempDir, writeTree } from "./helpers";

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
