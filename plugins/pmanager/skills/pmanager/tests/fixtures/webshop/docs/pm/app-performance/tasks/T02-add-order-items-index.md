---
id: T02
epic: app-performance
milestone: M2
title: Add index on order_items.order_id
status: todo
priority: must
depends-on: [T01]
estimate: S
owner: unassigned
updated: 2026-09-10
contract: 1
---

# T02 — Add index on order_items.order_id

## Context

Item lookups scan order_items (../epic.md, evidence row 2).

## What to do

Add a migration creating an index on order_items(order_id).

## Acceptance criteria

- [ ] Migration file exists and applies cleanly
- [ ] EXPLAIN on the item query shows the index in use

## Out of scope

- Query batching (T03).

## Notes
