---
id: T03
epic: app-performance
milestone: M2
title: Batch item queries
status: todo
priority: must
depends-on: [T02]
estimate: M
owner: unassigned
updated: 2026-09-10
contract: 1
---

# T03 — Batch item queries

## Context

One item query per order (../epic.md, evidence row 1).

## What to do

Replace the per-order loop with a single join or an IN query.

## Acceptance criteria

- [ ] /orders issues O(1) queries per request, asserted in a test
- [ ] Response JSON unchanged, contract test passes

## Out of scope

- Pagination (T04).

## Notes
