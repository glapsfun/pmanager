# Experiment security-fix-cuts

claude-code 2.1.325 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:f1b033fb06e7da3518aa048832befd16a48adb6d2aa36c5ebf0a254e54197ad8) · repo ee61961 (clean) · isolation config-dir

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 10 | 10 | 3 | harness-error 7 | 30% | 1.00 (1.00–1.00) | 520s | 54/47019 (3) | $4.52 (10) | $1.32 | 27 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| security-fix | with-skill | 48473 (32742–52974; n 3) | 37113 (21275–39993; n 3) | 1 (1–1; n 3) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | hit-repos-covered | fix-reaches-deploy | right-bump | no-unproven-safe | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% |

Spend: $4.52 across 10 attempts with cost telemetry; 10 attempts total.
