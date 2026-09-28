# Experiment m0-start

claude-code 2.1.283 · model claude-sonnet-5 · 1 condition · 3 pairs · timeout 900s · skill 0.5.0 (sha256:f1616d1130d8299c5e7449bd5a93809936c0f0be8e606ca7e61453c5c044682d) · repo cfe7f78 (dirty) · isolation config-dir

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 3 | 3 | 3 | — | 67% | 1.00 (0.96–1.00) | 290s | 50/23497 (3) | $2.56 (3) |
| feature-idea-epic | with-skill | 3 | 3 | 3 | — | 100% | 1.00 (1.00–1.00) | 317s | 50/27473 (3) | $2.94 (3) |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 29234 (26632–33624; n 3) | 36956 (31598–38040; n 3) | 2 (2–2; n 3) |
| feature-idea-epic | with-skill | 31844 (29531–33899; n 3) | 37137 (33917–37427; n 3) | 5 (3–6; n 3) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | evidence-cites-repo | metric-has-target | non-goals | draft-awaits-approval | riskiest-first | confidence-not-high |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 33% | — |
| feature-idea-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | 0% | 0% | 0% | — | 0% |

Spend: $5.50 across 6 attempts with cost telemetry; 6 attempts total.
