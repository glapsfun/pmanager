# Experiment fewer-steps

claude-code 2.1.311 · model claude-sonnet-5 · 2 conditions · 10 pairs · timeout 900s · skill 0.9.0 (sha256:9f9c4f0124d69fc5a2b954811371a266ed33824dffa8abe5d88fc359e85d9787) · repo a85801b (clean) · isolation config-dir · baseline 310df2d @ 310df2d

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 10 | 10 | 10 | — | 90% | 1.00 (1.00–1.00) | 255s | 23/23532 (10) | $6.56 (10) | $0.66 | 12 |
| perf-bug-new-epic | baseline-skill | 10 | 10 | 10 | — | 90% | 1.00 (1.00–1.00) | 265s | 64/21979 (10) | $9.97 (10) | $1.01 | 32 |
| feature-idea-epic | with-skill | 10 | 10 | 10 | — | 60% | 1.00 (0.92–1.00) | 247s | 18/22335 (10) | $6.28 (10) | $0.60 | 9 |
| feature-idea-epic | baseline-skill | 10 | 10 | 10 | — | 90% | 1.00 (1.00–1.00) | 268s | 51/23194 (10) | $9.15 (10) | $0.90 | 26 |

## Paired differences (with-skill minus baseline-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff | Cost diff median (IQR) | Duration diff median (IQR) | Steps diff median (IQR) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | 10 | 0 | +0.00 (+0.00–+0.00) | +0% | -0.35 (-0.43–-0.30) | -10s (-39s–+7s) | -20 (-25–-17; n 10) |
| feature-idea-epic | 10 | 0 | +0.00 (-0.08–+0.00) | -30% | -0.30 (-0.32–-0.27) | -13s (-35s–-6s) | -17 (-19–-15; n 10) |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 34939 (31316–35263; n 3) | 37140 (31593–37856; n 3) | 1 (0–1; n 10) |
| perf-bug-new-epic | baseline-skill | 35819 (32665–38908; n 10) | 37813 (37286–42072; n 10) | 2 (1–7; n 10) |
| feature-idea-epic | with-skill | 27458 (27081–27834; n 2) | 30992 (29835–32148; n 2) | 1 (1–1; n 10) |
| feature-idea-epic | baseline-skill | 31306 (29976–32541; n 10) | 35694 (31826–37568; n 10) | 3 (2–4; n 10) |

| Scenario | Context diff, with-skill minus baseline-skill (IQR; n) |
| :--- | ---: |
| perf-bug-new-epic | -1002 (-4414–+1436; n 3) |
| feature-idea-epic | -2691 (-3213–-2170; n 2) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | evidence-cites-repo | metric-has-target | non-goals | draft-awaits-approval | riskiest-first | confidence-not-high |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 10% | — |
| perf-bug-new-epic | baseline-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 10% | — |
| feature-idea-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | 40% | 0% | 0% | — | 0% |
| feature-idea-epic | baseline-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | 10% | 0% | 0% | — | 0% |

Spend: $31.97 across 40 attempts with cost telemetry; 40 attempts total.
