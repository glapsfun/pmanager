import { describe, expect, test } from "bun:test";
import {
  attachEvidence,
  type EvidenceLine,
  extractPathTokens,
  formatEvidence,
  labelCriterion,
  matchPaths,
  parseCriteria,
  tokeniseCriterion,
} from "../scripts/verify";

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

describe("tokeniseCriterion", () => {
  test("paths, backticked and snake_case identifiers", () => {
    const t = tokeniseCriterion(
      "Migration under app/migrations/ creates an index on `order_items(order_id)`; sets max_rows",
    );
    expect(t.paths).toEqual(["app/migrations/"]);
    expect(t.idents).toEqual(["order_items(order_id)", "order_items", "order_id", "max_rows"]);
    expect(t.measured).toBe(false);
  });
  test("numbers with units or comparisons mark measured", () => {
    expect(tokeniseCriterion("GET /orders p95 under 1s on the T01 dataset").measured).toBe(true);
    expect(tokeniseCriterion("error rate < 0.1%").measured).toBe(true);
    expect(tokeniseCriterion("at least 3 retries").measured).toBe(true);
    expect(tokeniseCriterion("/orders issues O(1) queries per request").measured).toBe(false);
    expect(tokeniseCriterion("A results file records p50/p95 for /orders").measured).toBe(false);
  });
});

describe("parseCriteria", () => {
  test("reads checked state and text from the Acceptance criteria section only", () => {
    const body = `## What to do\n\n- [ ] not a criterion\n\n## Acceptance criteria\n\n- [ ] Migration file exists\n- [x] EXPLAIN shows the index\n\n## Out of scope\n\n- [ ] also not\n`;
    const c = parseCriteria(body);
    expect(c.map((x) => [x.text, x.checked])).toEqual([
      ["Migration file exists", false],
      ["EXPLAIN shows the index", true],
    ]);
  });
});

describe("attachEvidence + labelCriterion", () => {
  const line = (source: string, fact: string, paths: string[]): EvidenceLine => ({
    source,
    fact,
    repo: ".",
    paths,
  });
  test("attaches by path token and by identifier, leaves the rest unattributed", () => {
    const criteria = [
      tokeniseCriterion("Migration under app/migrations/ creates an index on order_items"),
      tokeniseCriterion("Response JSON unchanged"),
    ];
    const lines = [
      line("app/migrations/001.sql", "present, 1 lines, last changed abc 2026-09-12", [
        "app/migrations/001.sql",
      ]),
      line("app/schema.sql", "+CREATE INDEX idx_order_items_order_id ON order_items(order_id)", [
        "app/schema.sql",
      ]),
      line("git log", "abc 2026-09-12 restore pagination · app/app.py", ["app/app.py"]),
    ];
    const { attached, unattributed } = attachEvidence(criteria, lines);
    expect(attached[0]?.map((l) => l.source)).toEqual(["app/migrations/001.sql", "app/schema.sql"]);
    expect(attached[1]).toEqual([]);
    expect(unattributed.map((l) => l.source)).toEqual(["git log"]);
  });
  test("labels", () => {
    const plain = {
      checked: false,
      tokens: tokeniseCriterion("Migration under app/migrations/ exists"),
    };
    expect(labelCriterion(plain, 3)).toBe("evidence: 3 lines");
    expect(labelCriterion(plain, 1)).toBe("evidence: 1 line");
    expect(labelCriterion(plain, 0)).toBe("no evidence in scope");
    const measured = { checked: false, tokens: tokeniseCriterion("p95 under 1s") };
    expect(labelCriterion(measured, 2)).toBe("needs measurement");
    const measuredPath = {
      checked: false,
      tokens: tokeniseCriterion("app/app.py answers in < 1s"),
    };
    expect(labelCriterion(measuredPath, 2)).toBe("evidence: 2 lines");
    expect(labelCriterion({ ...plain, checked: true }, 0)).toBe(
      "already checked · no evidence in scope",
    );
  });
  test("formatEvidence", () => {
    const l = line("app/app.py", "+x", ["app/app.py"]);
    expect(formatEvidence(l, false)).toBe("[app/app.py] +x");
    expect(formatEvidence({ ...l, repo: "webshop" }, true)).toBe("[webshop:app/app.py] +x");
  });
});
