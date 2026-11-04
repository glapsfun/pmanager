# Experiment attempt-capture-1

claude-code 2.1.317 · model claude-sonnet-5 · 1 condition · 3 pairs · timeout 900s · skill 0.10.1 (sha256:4b5b8cd13295d3c5902335a5dd1df66c7feedf6ab0318f550287d95f2501e3a0) · repo 97d906f (clean) · isolation config-dir

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tracking-update-memory | with-skill | 3 | 3 | 3 | — | 67% | 0.94 (0.92–0.94) | 136s | 42/10431 (3) | $1.65 (3) | $0.53 | 21 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| tracking-update-memory | with-skill | 24286 (21339–26374; n 3) | 24168 (19399–28093; n 3) | — |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | no-new-epic | t01-done | t02-blocked-noted | table-mirrors | index-counts | verified-evidence | t01-history-attempt | t01-history-sequence | t02-history-blocked | no-raw-log |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tracking-update-memory | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 33% | 0% | 0% | 0% | 0% |

Spend: $1.65 across 3 attempts with cost telemetry; 3 attempts total.
