# planning-traps-current: re-grade and hand audit

`attempts.jsonl` and `REPORT.md` hold grader version 1, as run. Version 1 counted
research tasks as readers of the new columns ("Confirm ShipFast credential
status", "Spike: locate the orders page and the total write path") and missed
"Serve ... GET /orders" as a reader of totals. Grader version 2 fixes both;
re-grading the ten saved plans (`artifacts/*/docs-pm`) with it gives:

| Check | Trap | Passed |
| :--- | :--- | ---: |
| migration-first | status work waits for the schema migration | 10/10 |
| backfill-before-reads | totals are served only after the cents backfill | 10/10 |
| consumer-repo-named | the iOS client repo is part of the plan | 10/10 |
| total-change-compatible | `total` stays a Double for shipped iOS apps | 10/10 |
| blocker-recorded | the ShipFast credential wait (OPS-112) is recorded | 10/10 |
| acceptance-testable | no vague acceptance or exit criterion | 8/10 |
| deps-follow-milestones | no task depends on a later milestone | 10/10 |

Reading every plan by hand agrees with version 2:

- Every plan adds the columns by additive migration, backfills existing rows
  before serving from the new column, keeps `total` on the wire for the iOS
  `Codable` model, and drops the old column only in a later release.
- Every ShipFast webhook task depends on an OPS-112 check, is `blocked`, or
  (p9) ships dormant behind a flag until OPS-112 is confirmed.
- Most plans hand the status field to the iOS team as a contract rather than
  planning work inside shop-ios; `docs/clients.md` says that team plans its
  own sprints, so this reads as a sound call.
- The two misses are milestone exit criteria for the "feel nicer" part of the
  request: "a light visual polish pass" (p1) and "updated
  layout/typography/visual polish ... is shipped" (p8). The tasks' own
  criteria were concrete (empty and loading states, status badges, design
  sign-off).
