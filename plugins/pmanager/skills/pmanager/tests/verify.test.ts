import { describe, expect, test } from "bun:test";
import { extractPathTokens, matchPaths } from "../scripts/verify";

describe("extractPathTokens", () => {
  test("keeps slashed paths and known file extensions, strips trailing punctuation", () => {
    const body =
      "Edit app/app.py and app/schema.sql (see tests/). Results in docs/profile-results.txt.";
    expect(extractPathTokens(body)).toEqual([
      "app/app.py",
      "app/schema.sql",
      "tests/",
      "docs/profile-results.txt",
    ]);
  });
  test("drops relative doc links, urls, numbers, spec paths and non-file dotted words", () => {
    const body =
      "See ../epic.md and https://example.com/a/b. p95 3.4s, e.g. order_items.order_id; docs/pm/x/epic.md";
    expect(extractPathTokens(body)).toEqual([]);
  });
  test("dedupes", () => {
    expect(extractPathTokens("app/app.py then app/app.py again")).toEqual(["app/app.py"]);
  });
});

describe("matchPaths", () => {
  const listed = [
    "app/app.py",
    "app/schema.sql",
    "tests/test_orders.py",
    "docs/pm/app-performance/epic.md",
    "docs/profile-results.txt",
  ];
  test("exact, directory prefix and basename matches", () => {
    expect(matchPaths("app/app.py", listed)).toEqual(["app/app.py"]);
    expect(matchPaths("tests/", listed)).toEqual(["tests/test_orders.py"]);
    expect(matchPaths("app.py", listed)).toEqual(["app/app.py"]);
    expect(matchPaths("schema.sql", listed)).toEqual(["app/schema.sql"]);
  });
  test("never matches docs/pm and returns empty for unknown tokens", () => {
    expect(matchPaths("epic.md", listed)).toEqual([]);
    expect(matchPaths("app/migrations/", listed)).toEqual([]);
  });
});
