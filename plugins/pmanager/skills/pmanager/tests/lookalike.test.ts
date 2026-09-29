import { describe, expect, test } from "bun:test";
import {
  type EpicSummary,
  epicWords,
  findLookAlikes,
  formatLookAlike,
  isLookAlike,
} from "../scripts/lookalike";

const epic = (slug: string, title: string, status = "in-progress"): EpicSummary => ({
  slug,
  title,
  status,
  session: null,
});

describe("epicWords", () => {
  test("slug and title, lowercased, 3+ characters, stopwords dropped", () => {
    expect([...epicWords("app-performance", "Fix orders page latency")].sort()).toEqual([
      "app",
      "latency",
      "orders",
      "page",
      "performance",
    ]);
    expect([...epicWords("orders-page-slow", "Orders page is slow")].sort()).toEqual([
      "orders",
      "page",
      "slow",
    ]);
  });
});

describe("isLookAlike", () => {
  test("two shared words, or one when a side has a single word", () => {
    const perf = epicWords("app-performance", "Fix orders page latency");
    expect(isLookAlike(epicWords("orders-page-slow", "Orders page is slow"), perf)).toBe(true);
    expect(isLookAlike(epicWords("csv-export", "CSV export for orders reports"), perf)).toBe(false);
    expect(
      isLookAlike(epicWords("billing", "Billing"), epicWords("billing-retry", "Retry billing")),
    ).toBe(true);
    expect(isLookAlike(epicWords("sso-login", "Single sign-on login"), perf)).toBe(false);
  });
});

describe("findLookAlikes", () => {
  test("ignores done, abandoned and the slug itself", () => {
    const epics = [
      epic("app-performance", "Fix orders page latency"),
      epic("orders-page-old", "Orders page latency", "done"),
      epic("orders-page-dropped", "Orders page latency", "abandoned"),
      epic("orders-page-slow", "Orders page is slow"),
    ];
    expect(
      findLookAlikes("orders-page-slow", "Orders page is slow", epics).map((e) => e.slug),
    ).toEqual(["app-performance"]);
  });

  test("formats one line with the owner", () => {
    const line = formatLookAlike({
      ...epic("app-performance", "Fix orders page latency"),
      session: { harness: "claude-code", claimed: "2026-09-10", branch: "pm/app-performance" },
    });
    expect(line).toBe(
      "  app-performance  in-progress  Fix orders page latency  (owner: claude-code · 2026-09-10)",
    );
    expect(formatLookAlike(epic("x-y", "X y"))).toContain("(owner: unclaimed)");
  });
});
