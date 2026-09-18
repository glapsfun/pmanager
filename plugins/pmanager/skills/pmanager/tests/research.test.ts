import { describe, expect, test } from "bun:test";
import { classifyPath, collectHits, normalizeKeywords, rankFiles } from "../scripts/research";

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
