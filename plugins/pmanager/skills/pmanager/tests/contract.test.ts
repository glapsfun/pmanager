import { describe, expect, test } from "bun:test";
import {
  contractVersion,
  formatFmValue,
  getList,
  getMap,
  getString,
  hasSection,
  parseDoc,
  parseYamlSubset,
  sectionBody,
  sessionOf,
  setFrontmatterKey,
  splitFrontmatter,
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
  test("ignores (required) suffix in the document", () => {
    expect(hasSection("## Problem statement (required)\n\ntext\n", "Problem statement")).toBe(true);
    expect(hasSection("## Other\n", "Problem statement")).toBe(false);
  });
});
