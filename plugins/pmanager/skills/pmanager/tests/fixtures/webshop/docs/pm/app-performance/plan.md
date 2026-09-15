---
epic: app-performance
status: in-progress
updated: 2026-09-10
contract: 1
---

# Plan — Fix orders page latency

## Approach

Confirm where time goes first, then bound the query path and the response size. The alternative, rewriting the storage layer, was rejected as disproportionate.

## Milestones

### M1 — Root cause confirmed by profile
Exit criteria:
- [ ] Benchmark shows where /orders time is spent

### M2 — Query path bounded
Exit criteria:
- [ ] /orders issues O(1) queries per request

### M3 — Response bounded
Exit criteria:
- [ ] /orders is paginated

## Task breakdown & traceability

<!-- pm:tasks:start -->
| Task | Title | Milestone | Priority | Depends on | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| T01 | Benchmark orders endpoint | M1 | must | — | todo |
| T02 | Add index on order_items.order_id | M2 | must | T01 | todo |
| T03 | Batch item queries | M2 | must | T02 | todo |
| T04 | Restore pagination | M3 | should | — | todo |
<!-- pm:tasks:end -->

## Prioritization

- Must: T01, T02, T03 — the hypothesis cannot be tested without them.
- Should: T04 — bounds the response independently of the query fix.
- Could: none
- Won't (this epic): storage-layer rewrite — mirrors the epic's non-goals.

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger / early signal |
| :--- | :--- | :--- | :--- | :--- |
| Index build locks table | low | med | build off-peak | migration > 5 min in staging |

## Dependencies

| Dependency | Kind | Owner | Status |
| :--- | :--- | :--- | :--- |
| DBA review for index | internal | @dba | pending |

## Definition of done (applies to every task)

- [ ] Acceptance criteria demonstrated
- [ ] Tests written/updated and passing

## Validation plan

- **Verification:** each milestone's exit criteria demonstrated in a PR.
- **Validation:** p95 /orders measured by the benchmark script one week after ship.

## Changelog

| Date | Change | Why |
| :--- | :--- | :--- |
| 2026-09-10 | Plan created | — |
