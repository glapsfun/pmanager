---
id: T01
epic: app-performance
milestone: M1
title: Benchmark orders endpoint
status: todo
priority: must
depends-on: []
estimate: S
owner: unassigned
updated: 2026-09-10
contract: 1
---

# T01 — Benchmark orders endpoint

## Context

Riskiest assumption first: confirm where /orders time is spent (../epic.md, evidence rows 1–2).

## What to do

Seed 1,000 orders with 10 items each and time GET /orders 20 times.

## Acceptance criteria

- [ ] A results file records p50/p95 for /orders
- [ ] The share of time spent in item queries is reported as a percentage

## Out of scope

- Any optimization.

## Notes
