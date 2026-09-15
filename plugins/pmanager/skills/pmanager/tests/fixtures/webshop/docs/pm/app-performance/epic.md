---
id: app-performance
title: Fix orders page latency
type: bug
status: in-progress
business-goal: Keep checkout conversion stable
owner: unassigned
created: 2026-09-01
updated: 2026-09-10
contract: 1
repos:
  - git@github.com:glapsfun/webshop.git
primary-metric: p95 /orders < 500ms
session:
  harness: claude-code
  claimed: 2026-09-10
  branch: pm/app-performance
---

# Fix orders page latency

## Problem statement (required)

The /orders page returns every order for every user since pagination was removed, and issues one item query per order against an unindexed table. Customers report the page is slow since July.

## Evidence (required)

| Source | Finding | Kind |
| :--- | :--- | :--- |
| [app/app.py:15] | N+1 query per order in /orders | behavioral |
| [app/schema.sql:12] | no index on order_items.order_id | behavioral |
| [git log 2026-07-02] | pagination removed from /orders | behavioral |
| [user] | "orders page got really slow in July" | stated |

**Confidence:** medium — a profile would raise it.

## Hypothesis (required)

We believe restoring pagination and batching item queries will cut /orders latency for customers, measured by p95 /orders reaching < 500ms within 1 week of ship.

## Business goal alignment

Slow order history erodes trust before repeat purchases.

## Stakeholders / affected users

Customers viewing order history; the web team.

## Success metrics (required)

| Metric | Role | Current | Target | Window | Measured via |
| :--- | :--- | :--- | :--- | :--- | :--- |
| p95 /orders latency | primary | unknown | < 500ms | 1 week post-ship | benchmark script |
| /orders error rate | guardrail | 0% | 0% | same | app logs |

## Scope

- /orders endpoint query path and pagination

## Non-goals (required)

- Storage-layer rewrite — out of proportion to the evidence.

## Open questions

- What latency counts as fixed? Assumed 500ms.

## Related prior work

none
