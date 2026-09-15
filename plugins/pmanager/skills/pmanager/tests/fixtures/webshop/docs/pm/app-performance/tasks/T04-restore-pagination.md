---
id: T04
epic: app-performance
milestone: M3
title: Restore pagination
status: todo
priority: should
depends-on: []
estimate: M
owner: unassigned
updated: 2026-09-10
contract: 1
---

# T04 — Restore pagination

## Context

Pagination was removed on 2026-07-02 (../epic.md, evidence row 3).

## What to do

Add page and page_size query parameters with a default page size of 50.

## Acceptance criteria

- [ ] GET /orders?page=2&page_size=50 returns the second page
- [ ] Default response is at most 50 orders

## Out of scope

- Client changes.

## Notes
