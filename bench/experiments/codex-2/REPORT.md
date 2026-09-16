# Experiment codex-2

codex 0.154.0 · model gpt-6-astra (high) · 2 conditions · 2 pairs · timeout 900s · skill 0.2.0 (sha256:4a9d5addee9d2145a6314f96c0f54c9a06ae47e4a31956df3aae47ed9343405c) · repo 35247b6 (clean) · isolation home-dir

**Preliminary**: fewer than 10 completed pairs.

**No cost telemetry** for this harness.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 2 | 2 | 1 | harness-error 1 | 0% | 0.93 (0.93–0.93) | 541s | 44875/17005 (1) | — |
| perf-bug-new-epic | without-skill | 2 | 2 | 2 | — | 0% | 0.71 (0.68–0.75) | 327s | 33725/10136 (2) | — |

## Paired differences (with-skill minus without-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff |
| :--- | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | 1 | 1 | +0.29 (+0.29–+0.29) | +0% |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | evidence-cites-repo | metric-has-target | non-goals | draft-awaits-approval | riskiest-first |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 0% | 0% | 0% |
| perf-bug-new-epic | without-skill | 0% | 100% | 100% | 50% | 0% | 0% | 0% | 0% | 0% | 0% | 50% | 0% | 0% | 100% |

Spend: — across 0 attempts with cost telemetry; 4 attempts total.
