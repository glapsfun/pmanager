import { describe, expect, test } from "bun:test";
import {
  estimateTokens,
  isDataPath,
  isDefinitionLine,
  isImportLine,
  lineBody,
  MIN_BUDGET,
  prune,
  sourcePath,
} from "../scripts/prune";
import { formatResearch, type ProbeResult, type ResearchReport } from "../scripts/research";

describe("estimateTokens", () => {
  test("a quarter of the characters, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("isDataPath", () => {
  test("lockfiles, data formats, minified and generated trees", () => {
    for (const p of [
      "bun.lock",
      "web/package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "Cargo.lock",
      "poetry.lock",
      "Gemfile.lock",
      "composer.lock",
      "bench/results/history.jsonl",
      "data/events.ndjson",
      "exports/orders.csv",
      "exports/orders.tsv",
      "static/app.min.js",
      "static/app.js.map",
      "src/__snapshots__/orders.test.ts.snap",
      "dist/index.js",
      "pkg/build/out.o",
      "vendor/lib/x.go",
      "node_modules/retry/index.js",
    ]) {
      expect(isDataPath(p)).toBe(true);
    }
  });
  test("source, config and docs stay", () => {
    for (const p of [
      "app/app.py",
      "package.json",
      "evals/evals.json",
      "config/app.yaml",
      "Cargo.toml",
      "docs/build-notes.md",
      "src/lockfile.ts",
    ]) {
      expect(isDataPath(p)).toBe(false);
    }
  });
});

describe("isImportLine", () => {
  test("import forms across languages", () => {
    for (const b of [
      'import { retry } from "../lib/retry";',
      "import sqlite3",
      'import{a}from"b"',
      'export * from "./orders";',
      'export { orders } from "./orders";',
      'export type { Order } from "./types";',
      "from flask import Flask, jsonify",
      "#include <stdio.h>",
      "using System.Linq;",
      "use std::collections::HashMap;",
      'const orders = require("./orders");',
      'require("dotenv").config();',
    ]) {
      expect(isImportLine(b)).toBe(true);
    }
  });
  test("ordinary code and prose are not imports", () => {
    for (const b of [
      "export function retryInvoice(invoice: Invoice) {",
      "important: orders are paged",
      "rows = conn.execute(query).fetchall()",
      '"use strict";',
      "// imports are resolved lazily",
    ]) {
      expect(isImportLine(b)).toBe(false);
    }
  });
});

describe("isDefinitionLine", () => {
  test("declarations", () => {
    for (const b of [
      "export function retryInvoice(invoice: Invoice) {",
      "async function load() {",
      "export default class Orders {",
      "def orders():",
      "async def orders():",
      "interface Order {",
      "export type Order = {",
      "enum Status {",
      "struct Order {",
      "fn main() {",
      "pub fn orders() {",
      "func Orders() {",
      "export const job01 = { name: 1 };",
      "const orders = [];",
    ]) {
      expect(isDefinitionLine(b)).toBe(true);
    }
  });
  test("references are not definitions", () => {
    for (const b of [
      "return retry(() => send(invoice));",
      "classify(orders)",
      "typeof orders",
      '@app.get("/orders")',
      "// def orders is below",
    ]) {
      expect(isDefinitionLine(b)).toBe(false);
    }
  });
});

describe("sourcePath and lineBody", () => {
  test("path without the line number; body without the keyword tag", () => {
    const line = "[app/app.py:12] def orders():  # kw: orders";
    expect(sourcePath(line)).toBe("app/app.py");
    expect(lineBody(line)).toBe("def orders():");
    expect(sourcePath("[tests/test_orders.py] kw: orders; references app")).toBe(
      "tests/test_orders.py",
    );
    expect(sourcePath("[git log] f177135 2026-07-02 remove pagination")).toBe("git log");
  });
});

const EMPTY: ProbeResult = { lines: [], shown: 0, total: 0 };

function section(lines: string[], grouped = false): ProbeResult {
  const shown = grouped ? new Set(lines.map(sourcePath)).size : lines.length;
  return { lines, shown, total: shown };
}

function report(over: Partial<ResearchReport["probes"]>): ResearchReport {
  return {
    repo: "/r",
    ref: "abc1234",
    keywords: ["orders"],
    paths: [],
    durationMs: 5,
    probes: {
      files: EMPTY,
      history: EMPTY,
      docs: EMPTY,
      memory: EMPTY,
      tests: EMPTY,
      gh: { ...EMPTY, error: "skipped (--no-gh)" },
      ...over,
    },
  };
}

describe("prune", () => {
  test("no noise within budget: same probes, zero counts, identical text", () => {
    const r = report({
      files: section(
        [
          "[app/app.py:12] def orders():  # kw: orders",
          "[app/app.py:14] rows = q(orders)  # kw: orders",
          "[app/schema.sql:1] CREATE TABLE orders (  # kw: orders",
        ],
        true,
      ),
      history: section(["[git log] f177135 2026-07-02 remove pagination from /orders"]),
    });
    const p = prune(r);
    expect(p.probes).toEqual(r.probes);
    expect(p.pruned).toEqual({ import: 0, data: 0, budget: 0, budgetTokens: 1500 });
    expect(formatResearch(p)).toBe(formatResearch(r));
  });

  test("imports dropped, an imports-only file collapses to one line, data files dropped", () => {
    const r = report({
      files: section(
        [
          '[src/a.ts:1] import { orders } from "./orders";  # kw: orders',
          "[src/a.ts:5] export function listOrders() {  # kw: orders",
          '[src/b.ts:1] import { orders } from "./orders";  # kw: orders',
          '[src/b.ts:2] const orders = require("./orders");  # kw: orders',
          '[data/orders.jsonl:1] {"orders": 1}  # kw: orders',
          "[dist/app.min.js:1] function orders(){}  # kw: orders",
        ],
        true,
      ),
    });
    const p = prune(r);
    expect(p.probes.files.lines).toEqual([
      "[src/a.ts:5] export function listOrders() {  # kw: orders",
      "[src/b.ts] imports orders",
    ]);
    expect(p.probes.files.shown).toBe(2);
    expect(p.probes.files.total).toBe(4);
    expect(p.pruned).toMatchObject({ import: 3, data: 2, budget: 0 });
    expect(formatResearch(p).split("\n")[1]).toBe(
      "pruned: 5 lines (import 3, data 2, budget 0) · --full shows all",
    );
  });

  test("the floor keeps three leads per section, definitions first, even past the budget", () => {
    const pad = "x".repeat(100);
    const files = Array.from({ length: 10 }, (_, i) => [
      `[src/f${i}.ts:1] // orders note ${pad}  # kw: orders`,
      `[src/f${i}.ts:2] export function orders${i}() { ${pad}  # kw: orders`,
    ]).flat();
    const history = Array.from(
      { length: 10 },
      (_, i) => `[git log] ${String(i).padStart(7, "0")} 2026-09-0${(i % 9) + 1} orders ${pad}`,
    );
    const r = report({ files: section(files, true), history: section(history) });
    const p = prune(r, MIN_BUDGET);
    expect(p.probes.files.lines).toEqual([files[1], files[3], files[5]] as string[]);
    expect(p.probes.files.shown).toBe(3);
    expect(p.probes.files.total).toBe(10);
    expect(p.probes.history.lines).toEqual(history.slice(0, 3));
    expect(p.pruned?.budget).toBe(30 - 6);
  });

  test("depth adds a file's other lines in their original order", () => {
    const r = report({
      files: section(
        [
          "[src/a.ts:1] // orders cache  # kw: orders",
          "[src/a.ts:4] export function orders() {  # kw: orders",
          "[src/a.ts:9] orders.clear()  # kw: orders",
        ],
        true,
      ),
    });
    expect(prune(r).probes.files.lines).toEqual(r.probes.files.lines);
  });

  test("errored and empty sections pass through untouched", () => {
    const r = report({ files: { ...EMPTY, error: "timed out after 0s" } });
    const p = prune(r);
    expect(p.probes.files).toEqual(r.probes.files);
    expect(p.probes.gh).toEqual(r.probes.gh);
    expect(p.probes.memory).toEqual(EMPTY);
  });
});
