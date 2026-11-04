# Experiment memory-recall-current

claude-code 2.1.317 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 900s · skill 0.10.1 (sha256:8d079e260a8f2c2cd4ba9a1aed0925649a134aea2738ad31d143d2f397243e23) · repo 9a94721 (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| memory-recall | with-skill | 10 | 10 | 10 | — | 50% | 0.94 (0.94–1.00) | 398s | 47/35187 (10) | $10.39 (10) | $1.07 | 24 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| memory-recall | with-skill | 52648 (48572–54984; n 10) | 55497 (49850–60223; n 10) | 0 (0–0; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | new-spec-log | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | memo-lesson-applied | prior-epic-cited | prior-lesson-applied | stale-not-followed |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| memory-recall | with-skill | 0% | 10% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 50% | 0% | 0% | 0% |

Spend: $10.39 across 10 attempts with cost telemetry; 10 attempts total.
