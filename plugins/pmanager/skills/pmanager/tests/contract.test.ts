import { describe, expect, test } from "bun:test";
import {
  contractVersion,
  formatFmValue,
  getList,
  getMap,
  getString,
  hasSection,
  parseDoc,
  parseHistory,
  parseYamlSubset,
  sectionBody,
  sessionFields,
  sessionOf,
  setFrontmatterKey,
  splitFrontmatter,
  withoutSection,
} from "../scripts/contract";

const EPIC = `---
id: app-performance
title: Fix orders page latency
type: bug
status: in-progress
owner: unassigned
created: 2026-09-01
updated: 2026-09-10
contract: 1
repos:
  - git@github.com:glapsfun/webshop.git
session:
  harness: claude-code
  claimed: 2026-09-10
  branch: pm/app-performance
depends-on: [T01, T02]   # inline list with comment
---

# Fix orders page latency

## Problem statement (required)

Orders page is slow.

## Evidence (required)

| Source | Finding | Kind |
`;

describe("splitFrontmatter", () => {
  test("splits yaml and body", () => {
    const parts = splitFrontmatter(EPIC);
    expect(parts?.yaml.startsWith("id: app-performance")).toBe(true);
    expect(parts?.body.startsWith("\n# Fix orders")).toBe(true);
  });
  test("returns null without frontmatter", () => {
    expect(splitFrontmatter("# just a doc\n")).toBeNull();
  });
});

describe("parseYamlSubset", () => {
  test("parses scalars, block lists, inline lists, nested maps", () => {
    const fm = parseYamlSubset(splitFrontmatter(EPIC)?.yaml ?? "");
    expect(fm.id).toBe("app-performance");
    expect(fm.contract).toBe("1");
    expect(fm.repos).toEqual(["git@github.com:glapsfun/webshop.git"]);
    expect(fm.session).toEqual({
      harness: "claude-code",
      claimed: "2026-09-10",
      branch: "pm/app-performance",
    });
    expect(fm["depends-on"]).toEqual(["T01", "T02"]);
  });
  test("empty inline list and empty value", () => {
    const fm = parseYamlSubset("depends-on: []\nrepos:\n");
    expect(fm["depends-on"]).toEqual([]);
    expect(fm.repos).toBe("");
  });
  test("strips quotes", () => {
    const fm = parseYamlSubset('title: "A: b"\n');
    expect(fm.title).toBe("A: b");
  });
  test("throws on garbage", () => {
    expect(() => parseYamlSubset("not yaml at all\n")).toThrow();
  });
});

describe("parseDoc and accessors", () => {
  const doc = parseDoc("docs/pm/app-performance/epic.md", EPIC);
  test("keeps path, raw, body", () => {
    expect(doc.path).toBe("docs/pm/app-performance/epic.md");
    expect(doc.raw).toBe(EPIC);
    expect(doc.body.includes("## Problem statement")).toBe(true);
  });
  test("getString/getList/getMap", () => {
    expect(getString(doc.frontmatter, "title")).toBe("Fix orders page latency");
    expect(getString(doc.frontmatter, "missing")).toBeUndefined();
    expect(getList(doc.frontmatter, "repos")).toEqual(["git@github.com:glapsfun/webshop.git"]);
    expect(getList(doc.frontmatter, "missing")).toEqual([]);
    expect(getMap(doc.frontmatter, "session")?.harness).toBe("claude-code");
  });
  test("contractVersion and sessionOf", () => {
    expect(contractVersion(doc.frontmatter)).toBe(1);
    expect(contractVersion({})).toBe(0);
    expect(contractVersion({ contract: "x" })).toBe(0);
    expect(sessionOf(doc.frontmatter)).toEqual({
      harness: "claude-code",
      claimed: "2026-09-10",
      branch: "pm/app-performance",
    });
    expect(sessionOf({})).toBeNull();
    expect(sessionOf({ session: "" })).toBeNull();
  });
  test("sessionOf reads an id when present and leaves it out otherwise", () => {
    const fm = {
      session: { harness: "pi", claimed: "2026-09-28", branch: "pm/x", id: "a1b2c3" },
    };
    expect(sessionOf(fm)).toEqual({
      harness: "pi",
      claimed: "2026-09-28",
      branch: "pm/x",
      id: "a1b2c3",
    });
    expect(
      sessionOf({ session: { harness: "pi", claimed: "2026-09-28", branch: "pm/x" } }),
    ).toEqual({
      harness: "pi",
      claimed: "2026-09-28",
      branch: "pm/x",
    });
    expect(sessionFields({ harness: "pi", claimed: "d", branch: "b", id: "x" })).toEqual({
      harness: "pi",
      claimed: "d",
      branch: "b",
      id: "x",
    });
  });
  test("doc without frontmatter has empty frontmatter", () => {
    const d = parseDoc("x.md", "# hi\n");
    expect(d.frontmatter).toEqual({});
    expect(d.body).toBe("# hi\n");
  });
  test("parseDoc tolerates broken frontmatter with empty result", () => {
    const d = parseDoc("x.md", "---\nnot yaml\n---\nbody\n");
    expect(d.frontmatter).toEqual({});
    expect(d.body).toBe("body\n");
  });
});

describe("formatFmValue and setFrontmatterKey", () => {
  test("formats scalar, list, empty list, map", () => {
    expect(formatFmValue("status", "done")).toBe("status: done\n");
    expect(formatFmValue("repos", [])).toBe("repos: []\n");
    expect(formatFmValue("repos", ["a", "b"])).toBe("repos:\n  - a\n  - b\n");
    expect(formatFmValue("session", { harness: "pi", claimed: "2026-09-15", branch: "pm/x" })).toBe(
      "session:\n  harness: pi\n  claimed: 2026-09-15\n  branch: pm/x\n",
    );
  });
  test("replaces an existing scalar in place", () => {
    const out = setFrontmatterKey(EPIC, "status", "done");
    expect(out).toContain("status: done\n");
    expect(out).not.toContain("status: in-progress");
    expect(out.indexOf("status: done")).toBeLessThan(out.indexOf("owner:"));
  });
  test("replaces a nested block and removes a key", () => {
    const replaced = setFrontmatterKey(EPIC, "session", {
      harness: "pi",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
    expect(replaced).toContain("  harness: pi\n");
    expect(replaced).not.toContain("claude-code");
    const removed = setFrontmatterKey(replaced, "session", undefined);
    expect(removed).not.toContain("session:");
    expect(removed).toContain("depends-on: [T01, T02]");
  });
  test("appends a missing key before the closing fence", () => {
    const out = setFrontmatterKey(EPIC, "primary-metric", "p95 < 500ms");
    const yaml = splitFrontmatter(out)?.yaml ?? "";
    expect(yaml.endsWith("primary-metric: p95 < 500ms\n")).toBe(true);
    expect(parseYamlSubset(yaml)["primary-metric"]).toBe("p95 < 500ms");
  });
  test("round-trips: parse(set(x)) equals expectation", () => {
    const out = setFrontmatterKey(EPIC, "repos", ["u1", "u2"]);
    expect(getList(parseDoc("e", out).frontmatter, "repos")).toEqual(["u1", "u2"]);
  });
});

describe("sections", () => {
  const body =
    "\n# T\n\n## Context\n\nwhy\n\n## Acceptance criteria\n\n- [ ] a\n- [x] b\n\n## Notes\n";
  test("sectionBody returns text under heading", () => {
    expect(sectionBody(body, "Acceptance criteria")?.trim()).toBe("- [ ] a\n- [x] b");
    expect(sectionBody(body, "Missing")).toBeNull();
    expect(sectionBody(body, "Notes")?.trim()).toBe("");
  });
  test("withoutSection drops one section and keeps the rest", () => {
    const doc = "## Notes\n\nkeep\n\n## History\n\n- drop\n\n## Out of scope\n\nalso keep\n";
    expect(withoutSection(doc, "History")).toBe(
      "## Notes\n\nkeep\n\n## Out of scope\n\nalso keep\n",
    );
    expect(withoutSection(doc, "Missing")).toBe(doc);
    expect(withoutSection("## History\n\n- drop\n", "History")).toBe("");
  });
  test("ignores (required) suffix in the document", () => {
    expect(hasSection("## Problem statement (required)\n\ntext\n", "Problem statement")).toBe(true);
    expect(hasSection("## Other\n", "Problem statement")).toBe(false);
  });
});

describe("parseHistory", () => {
  test("null without a History section; empty section is valid", () => {
    expect(parseHistory("## Notes\n\nx\n")).toBeNull();
    expect(parseHistory("## History\n")).toEqual({ entries: [], invalid: [] });
  });
  test("status line, with and without fixed by", () => {
    const h = parseHistory(
      "## History\n\n- 2026-11-03 status todo -> in-progress\n- 2026-11-04 status in-progress -> done; fixed by seeding inside one transaction\n",
    );
    expect(h?.entries).toEqual([
      { kind: "status", date: "2026-11-03", from: "todo", to: "in-progress", fixedBy: null },
      {
        kind: "status",
        date: "2026-11-04",
        from: "in-progress",
        to: "done",
        fixedBy: "seeding inside one transaction",
      },
    ]);
    expect(h?.invalid).toEqual([]);
  });
  test("attempt fields keep colons and hashes", () => {
    const h = parseHistory(
      "## History\n\n- 2026-11-03 attempt failed: tried seeding 1,000 orders; got error: database is locked (see #12); evidence docs/attempt-1.log\n",
    );
    expect(h?.entries).toEqual([
      {
        kind: "attempt",
        date: "2026-11-03",
        tried: "seeding 1,000 orders",
        got: "error: database is locked (see #12)",
        evidence: "docs/attempt-1.log",
      },
    ]);
  });
  test("an optional 'at' before the evidence path is dropped", () => {
    const h = parseHistory(
      "## History\n\n- 2026-11-03 attempt failed: tried one insert per commit; got a lock; evidence at docs/attempt-1.log\n",
    );
    expect(h?.entries).toEqual([
      {
        kind: "attempt",
        date: "2026-11-03",
        tried: "one insert per commit",
        got: "a lock",
        evidence: "docs/attempt-1.log",
      },
    ]);
  });
  test("CRLF, trailing spaces and blank lines are accepted", () => {
    const h = parseHistory("## History\r\n\r\n- 2026-11-03 status todo -> blocked   \r\n\r\n");
    expect(h?.entries).toHaveLength(1);
    expect(h?.invalid).toEqual([]);
  });
  test("lines in neither form are invalid", () => {
    const bad = [
      "Started work on Monday.",
      "- 2026-11-03 status todo -> started",
      "- 2026-02-30 status todo -> done",
      "- 2026-11-03 attempt failed: tried ; got x; evidence y",
      "2026-11-03 status todo -> done",
    ];
    expect(parseHistory(`## History\n\n${bad.join("\n")}\n`)?.invalid).toEqual(bad);
  });
  test("only the History section is read, wherever it sits", () => {
    const h = parseHistory(
      "## History\n\n- 2026-11-03 status todo -> in-progress\n\n## Notes\n\nfree text: anything\n",
    );
    expect(h).toEqual({ entries: [expect.objectContaining({ to: "in-progress" })], invalid: [] });
  });
});
