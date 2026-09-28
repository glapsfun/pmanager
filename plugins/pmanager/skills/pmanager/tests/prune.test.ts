import { describe, expect, test } from "bun:test";
import {
  estimateTokens,
  isDataPath,
  isDefinitionLine,
  isImportLine,
  lineBody,
  sourcePath,
} from "../scripts/prune";

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
