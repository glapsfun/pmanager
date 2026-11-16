# Experiment security-fix-cuts-b

claude-code 2.1.325 · model claude-sonnet-5 · 1 condition · 7 pairs · timeout 1500s · skill 0.11.0 (sha256:f1b033fb06e7da3518aa048832befd16a48adb6d2aa36c5ebf0a254e54197ad8) · repo caab601 (clean) · isolation config-dir

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 7 | 7 | 7 | — | 57% | 1.00 (0.94–1.00) | 419s | 52/37215 (7) | $7.71 (7) | $1.04 | 26 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| security-fix | with-skill | 42554 (41143–50258; n 7) | 38419 (34334–51189; n 7) | 0 (0–0; n 7) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | hit-repos-covered | fix-reaches-deploy | right-bump | no-unproven-safe | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 14% | 14% | 29% | 0% | 0% |

Spend: $7.71 across 7 attempts with cost telemetry; 7 attempts total.
