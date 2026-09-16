# Experiment pilot-2

claude-code 2.1.273 · model claude-sonnet-5 · 2 conditions · 2 pairs · timeout 900s · skill 0.2.0 (sha256:4a9d5addee9d2145a6314f96c0f54c9a06ae47e4a31956df3aae47ed9343405c) · repo 35247b6 (dirty) · isolation config-dir

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 2 | 2 | 2 | — | 100% | 1.00 (1.00–1.00) | 288s | 50/24084 (2) | $1.54 (2) |
| perf-bug-new-epic | without-skill | 2 | 2 | 2 | — | 0% | 0.79 (0.79–0.79) | 200s | 32/18718 (2) | $1.16 (2) |

## Paired differences (with-skill minus without-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff |
| :--- | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | 2 | 0 | +0.21 (+0.21–+0.21) | +100% |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | evidence-cites-repo | metric-has-target | non-goals | draft-awaits-approval | riskiest-first |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| perf-bug-new-epic | without-skill | 0% | 100% | 100% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 100% |

Spend: $2.71 across 4 attempts with cost telemetry; 4 attempts total.
