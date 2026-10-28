# Experiment planning-traps-current

claude-code 2.1.312 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 900s · skill 0.9.0 (sha256:07775e4b0733aeb436297457b030c4c4d5583238e1f41db84bda8b36afd028fb) · repo 67d8c97 (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planning-traps | with-skill | 10 | 10 | 10 | — | 20% | 0.94 (0.90–0.94) | 466s | 29/41966 (10) | $9.41 (10) | $0.96 | 15 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| planning-traps | with-skill | 43988 (38896–52843; n 4) | 33508 (31910–35998; n 4) | 1 (1–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | migration-first | backfill-before-reads | consumer-repo-named | total-change-compatible | blocker-recorded | acceptance-testable | deps-follow-milestones |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| planning-traps | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 60% | 30% | 0% | 0% | 0% | 20% | 0% |

Spend: $9.41 across 10 attempts with cost telemetry; 10 attempts total.
