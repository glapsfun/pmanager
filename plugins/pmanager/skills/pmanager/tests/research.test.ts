import { describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import {
  buildResearch,
  classifyPath,
  collectFileHits,
  collectHits,
  formatResearch,
  mergeCommits,
  normalizeKeywords,
  parseLog,
  probeGh,
  probeHistoryGrep,
  probeMemory,
  probeTests,
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

describe("mergeCommits", () => {
  test("dedupes by sha, newest first, capped", () => {
    const r = mergeCommits(
      [
        [{ sha: "a", date: "2026-09-01", subject: "old" }],
        [
          { sha: "b", date: "2026-09-11", subject: "new" },
          { sha: "a", date: "2026-09-01", subject: "old" },
        ],
      ],
      1,
    );
    expect(r.lines).toEqual(["[git log] b 2026-09-11 new"]);
    expect(r.shown).toBe(1);
    expect(r.total).toBe(2);
  });
});

describe("probeTests", () => {
  test("keyword-hit tests and basename references, memory and non-test paths excluded", async () => {
    const dir = await seededRepo({
      "app/orders.py": "def orders(): pass\n",
      "tests/test_orders.py": "from app import orders\n",
      "tests/test_util.py": "import app.orders\n",
      "app/consumer.py": "from app import orders\n",
    });
    const r = await probeTests(
      { ...OPTS, cwd: dir, keywords: ["orders"] },
      [{ path: "tests/test_orders.py", keywords: ["orders"], hits: 2 }],
      ["app/orders.py"],
    );
    expect(r.error).toBeUndefined();
    expect(r.lines).toEqual([
      "[tests/test_orders.py] kw: orders; references orders",
      "[tests/test_util.py] references orders",
    ]);
  });
});

describe("buildResearch + formatResearch", () => {
  test("sections, header, scoping and exclusions on the webshop fixture", async () => {
    const root = await makeTempDir("research");
    await copyFixture(root);
    await writeTree(root, { "README.md": "# Webshop\n\nOrders are listed at /orders.\n" });
    await initGitRepo(root);
    await gitOk(["add", "-A"], root);
    await gitOk(["commit", "-q", "-m", "orders: seed webshop"], root);
    const report = await buildResearch({
      root,
      cwd: root,
      keywords: ["Orders", "sqlite"],
      paths: [],
      limit: 20,
      gh: false,
    });
    expect(report.ref).toMatch(/^[0-9a-f]{7,}$/);
    expect(report.keywords).toEqual(["orders", "sqlite"]);
    expect(report.probes.files.lines[0]).toBe("[app/app.py:2] import sqlite3  # kw: sqlite");
    expect(report.probes.files.lines.join("\n")).toContain("[app/schema.sql:");
    expect(report.probes.files.lines.join("\n")).not.toContain("docs/pm/");
    expect(report.probes.files.total).toBe(2);
    expect(report.probes.docs.lines[0]).toBe(
      "[README.md:3] Orders are listed at /orders.  # kw: orders",
    );
    expect(report.probes.history.lines[0]).toMatch(
      /^\[git log\] [0-9a-f]{7,} \d{4}-\d{2}-\d{2} orders: seed webshop$/,
    );
    expect(report.probes.memory.lines[0]).toContain("[docs/pm/INDEX.md]");
    expect(report.probes.tests).toEqual({ lines: [], shown: 0, total: 0 });
    expect(report.probes.gh.error).toBe("skipped (--no-gh)");

    const text = formatResearch(report);
    expect(text.split("\n")[0]).toMatch(
      /^research: .* @ [0-9a-f]{7,} · keywords: orders, sqlite · paths: \(all\) · \d+ms$/,
    );
    expect(text).toContain("\nfiles (2):\n  [app/app.py:");
    expect(text).toContain("\ntests: none\n");
    expect(text).toContain("\ngh: skipped (--no-gh)\n");

    const scoped = await buildResearch({
      root,
      cwd: root,
      keywords: ["orders"],
      paths: ["app/app.py"],
      limit: 20,
      gh: false,
    });
    expect(scoped.probes.files.lines.join("\n")).not.toContain("schema.sql");
    expect(scoped.probes.docs.total).toBe(0);
    expect(formatResearch(scoped).split("\n")[0]).toContain("paths: app/app.py");
  });
  test("limit truncation is visible in the section header", async () => {
    const dir = await seededRepo({
      "a/x1.py": "orders\n",
      "a/x2.py": "orders\n",
      "a/x3.py": "orders\n",
    });
    const report = await buildResearch({
      root: dir,
      cwd: dir,
      keywords: ["orders"],
      paths: [],
      limit: 2,
      gh: false,
    });
    expect(report.probes.files.shown).toBe(2);
    expect(report.probes.files.total).toBe(3);
    expect(formatResearch(report)).toContain("\nfiles (2 of 3):\n");
  });
  test("a probe failure is a section line and the report still builds", async () => {
    const dir = await seededRepo({ "a.py": "orders\n" });
    const report = await buildResearch({
      root: dir,
      cwd: dir,
      keywords: ["orders"],
      paths: [],
      limit: 20,
      gh: false,
      timeoutMs: 0,
    });
    expect(report.probes.files.error).toBe("timed out after 0s");
    expect(formatResearch(report)).toContain("\nfiles: timed out after 0s\n");
  });
});

async function ghStub(body: string): Promise<string> {
  const dir = await makeTempDir("ghstub");
  const file = join(dir, "gh");
  await Bun.write(file, `#!/usr/bin/env bun\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

describe("probeGh", () => {
  const o = {
    cwd: process.cwd(),
    keywords: ["orders", "timeout"],
    paths: [],
    limit: 20,
    timeoutMs: 5_000,
  };

  test("prints merged PRs and issues from JSON", async () => {
    const stub = await ghStub(`
const args = process.argv.slice(2);
const search = args[args.indexOf("--search") + 1];
if (search !== "orders timeout") { console.error("bad search: " + search); process.exit(3); }
if (args[0] === "pr") console.log(JSON.stringify([{ number: 212, title: "Batch order item queries", mergedAt: "2026-09-08T10:00:00Z", url: "u" }]));
else console.log(JSON.stringify([{ number: 300, title: "Orders page slow", state: "OPEN", updatedAt: "2026-09-12T10:00:00Z", url: "u" }]));
`);
    const r = await probeGh(o, stub);
    expect(r.error).toBeUndefined();
    expect(r.lines).toEqual([
      "[gh pr #212] merged 2026-09-08 · Batch order item queries",
      "[gh issue #300] open 2026-09-12 · Orders page slow",
    ]);
  });
  test("not installed", async () => {
    const r = await probeGh(o, "/nonexistent/gh");
    expect(r.error).toBe("unavailable (not installed)");
    expect(r.lines).toEqual([]);
  });
  test("timeout", async () => {
    const stub = await ghStub("await new Promise((r) => setTimeout(r, 10_000));");
    const r = await probeGh({ ...o, timeoutMs: 100 }, stub);
    expect(r.error).toBe("unavailable (timed out after 0s)");
  });
  test("non-zero exit reports the first stderr line", async () => {
    const stub = await ghStub(
      'console.error("not logged in to github.com\\nrun gh auth login"); process.exit(4);',
    );
    const r = await probeGh(o, stub);
    expect(r.error).toBe("unavailable (not logged in to github.com)");
  });
  test("malformed JSON is an error line", async () => {
    const stub = await ghStub('console.log("not json");');
    const r = await probeGh(o, stub);
    expect(r.error).toBe("unavailable (unreadable gh output)");
  });
});
