import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  classifyPath,
  collectFileHits,
  collectHits,
  normalizeKeywords,
  parseLog,
  probeHistoryGrep,
  probeMemory,
  rankFiles,
} from "../scripts/research";
import { copyFixture, gitOk, initGitRepo, makeTempDir, writeTree } from "./helpers";

async function seededRepo(files: Record<string, string>, message = "seed"): Promise<string> {
  const dir = await makeTempDir("research");
  await initGitRepo(dir);
  await writeTree(dir, files);
  await gitOk(["add", "-A"], dir);
  await gitOk(["commit", "-q", "-m", message], dir);
  return dir;
}

const OPTS = { paths: [] as string[], limit: 20, timeoutMs: 30_000 };

describe("classifyPath", () => {
  test("memory dirs", () => {
    expect(classifyPath("docs/pm/INDEX.md")).toBe("memory");
    expect(classifyPath("docs/sre-incidents/INDEX.md")).toBe("memory");
  });
  test("tests before docs", () => {
    expect(classifyPath("tests/test_orders.py")).toBe("test");
    expect(classifyPath("src/orders.test.ts")).toBe("test");
    expect(classifyPath("pkg/orders_test.go")).toBe("test");
    expect(classifyPath("tests/README.md")).toBe("test");
  });
  test("docs", () => {
    expect(classifyPath("README.md")).toBe("doc");
    expect(classifyPath("docs/adr/0007-cache.md")).toBe("doc");
    expect(classifyPath("runbooks/orders.txt")).toBe("doc");
    expect(classifyPath("notes.rst")).toBe("doc");
  });
  test("everything else is code", () => {
    expect(classifyPath("app/app.py")).toBe("code");
    expect(classifyPath("app/schema.sql")).toBe("code");
    expect(classifyPath("docker/Dockerfile")).toBe("code");
  });
});

describe("normalizeKeywords", () => {
  test("lowercases, trims, dedupes, drops empties", () => {
    expect(normalizeKeywords([" Orders", "orders", "", "Timeout "])).toEqual(["orders", "timeout"]);
  });
});

describe("collectHits + rankFiles", () => {
  test("two keywords outrank many hits of one; path-name matches count", () => {
    const hits = collectHits(
      ["orders", "timeout"],
      ["app/app.py:9\napp/orders.py:1\n", "app/orders.py:1\n"],
      ["app/app.py", "app/orders.py", "app/timeouts.py"],
    );
    const ranked = rankFiles(hits);
    expect(ranked.map((h) => h.path)).toEqual(["app/orders.py", "app/app.py", "app/timeouts.py"]);
    expect(ranked[0]).toEqual({ path: "app/orders.py", keywords: ["orders", "timeout"], hits: 3 });
    expect(ranked[2]).toEqual({ path: "app/timeouts.py", keywords: ["timeout"], hits: 1 });
  });
  test("ties break by hit count, then path", () => {
    const ranked = rankFiles([
      { path: "b.py", keywords: ["a"], hits: 2 },
      { path: "a.py", keywords: ["a"], hits: 2 },
      { path: "c.py", keywords: ["a"], hits: 5 },
    ]);
    expect(ranked.map((h) => h.path)).toEqual(["c.py", "a.py", "b.py"]);
  });
});

describe("collectFileHits", () => {
  test("counts content hits per keyword and path-name matches, scoped by --path", async () => {
    const dir = await seededRepo({
      "app/orders.py": "def orders():\n    return timeout\n",
      "lib/util.py": "orders = 1\n",
      "docs/pm/INDEX.md": "| orders |\n",
      "img.bin": "\u0000 orders ",
    });
    const all = await collectFileHits({ ...OPTS, cwd: dir, keywords: ["orders", "timeout"] });
    expect(all.error).toBeUndefined();
    const paths = all.hits.map((h) => h.path).sort();
    expect(paths).toEqual(["app/orders.py", "docs/pm/INDEX.md", "lib/util.py"]);
    const orders = all.hits.find((h) => h.path === "app/orders.py");
    expect(orders).toEqual({ path: "app/orders.py", keywords: ["orders", "timeout"], hits: 3 });

    const scoped = await collectFileHits({
      ...OPTS,
      cwd: dir,
      keywords: ["orders"],
      paths: ["lib"],
    });
    expect(scoped.hits.map((h) => h.path)).toEqual(["lib/util.py"]);
  });
  test("no matches is empty, not an error", async () => {
    const dir = await seededRepo({ "a.txt": "nothing here\n" });
    const r = await collectFileHits({ ...OPTS, cwd: dir, keywords: ["zzz"] });
    expect(r).toEqual({ hits: [] });
  });
  test("timeout surfaces as an error", async () => {
    const dir = await seededRepo({ "a.txt": "x\n" });
    const r = await collectFileHits({ ...OPTS, cwd: dir, keywords: ["x"], timeoutMs: 0 });
    expect(r.error).toBe("timed out after 0s");
  });
});

describe("probeHistoryGrep", () => {
  test("finds commits whose subject mentions a keyword, case-insensitive", async () => {
    const dir = await seededRepo({ "a.txt": "1\n" }, "Orders: drop pagination");
    await writeTree(dir, { "a.txt": "2\n" });
    await gitOk(["commit", "-q", "-am", "unrelated"], dir);
    const r = await probeHistoryGrep({ ...OPTS, cwd: dir, keywords: ["orders"] });
    expect(r.error).toBeUndefined();
    expect(r.commits.map((c) => c.subject)).toEqual(["Orders: drop pagination"]);
    expect(r.commits[0]?.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(r.commits[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseLog", () => {
  test("splits tab-separated lines and skips blanks", () => {
    expect(parseLog("abc1234\t2026-09-11\torders: x\n\n")).toEqual([
      { sha: "abc1234", date: "2026-09-11", subject: "orders: x" },
    ]);
  });
});

describe("probeMemory", () => {
  test("matches index rows, skips header and separator rows", async () => {
    const root = await makeTempDir("research");
    await copyFixture(root);
    await writeTree(root, {
      "docs/sre-incidents/INDEX.md":
        "# Incidents\n\n| Date | Title | Root cause |\n| :--- | :--- | :--- |\n| 2026-08-30 | orders p95 spike | missing index |\n| 2026-07-01 | login outage | expired cert |\n",
    });
    const r = await probeMemory(root, ["orders"], 20);
    expect(r.error).toBeUndefined();
    expect(r.lines).toEqual([
      "[docs/sre-incidents/INDEX.md] 2026-08-30 | orders p95 spike | missing index",
      "[docs/pm/INDEX.md] [app-performance](app-performance/epic.md) | Fix orders page latency | bug | in-progress | unassigned | claude-code · 2026-09-10 | glapsfun/webshop | 0/4 | p95 /orders < 500ms | 2026-09-10",
    ]);
    expect(r.shown).toBe(2);
    expect(r.total).toBe(2);
  });
  test("header keyword does not match; missing files give an empty section", async () => {
    const root = await makeTempDir("research");
    await copyFixture(root);
    expect((await probeMemory(root, ["title"], 20)).lines).toEqual([]);
    expect(await probeMemory(await makeTempDir("empty"), ["orders"], 20)).toEqual({
      lines: [],
      shown: 0,
      total: 0,
    });
  });
});
