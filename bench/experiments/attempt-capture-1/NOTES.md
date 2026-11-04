# attempt-capture-1: notes

Pass bar from the design: all 3 runs pass `t01-history-attempt`, `t01-history-sequence`, `t02-history-blocked` and `no-raw-log` (`tracking-update-memory`, grader version 2). All 3 pass all four, so there is no reword and no `attempt-capture-2`.

| Pair | Score | Steps (model calls) | Cost |
| ---: | ---: | ---: | ---: |
| 1 | 0.94 | 21 | $0.53 |
| 2 | 0.89 | 19 | $0.44 |
| 3 | 0.94 | 28 | $0.68 |

No claude-sonnet-5 run of this scenario exists for main, so the step counts are a reference for later runs, not a measured overhead.

## Other failed checks

- `verified-evidence`, pair 2: T01 never names `docs/profile-results.txt`. All three runs ran `pm verify app-performance T01 --files docs/profile-results.txt`. Pair 2 checked off both criteria without citing the file; pair 1 cited it next to the criteria and pair 3 in Notes. The done-claim step in `references/tracking.md` asks for no citation, on main or on this branch, so this looks like existing behavior rather than an effect of History. Not proven: that needs a run of main on this scenario, which was not made.
- `next-not-t03` (diagnostic, not scored), all three: pair 1's final message recommends no task, and pairs 2 and 3 recommend the blocked tasks T02 and T03.
