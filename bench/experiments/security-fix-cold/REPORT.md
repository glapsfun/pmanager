# Experiment security-fix-cold

claude-code 2.1.322 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:5d44c8da2d82d783c4c38f0d0a557add91b8755976772075486c53bcc6570f30) · repo 0727d6a (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 10 | 10 | 10 | — | 0% | 0.71 (0.65–0.71) | 432s | 59/39519 (10) | $12.02 (10) | $1.09 | 30 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| security-fix | with-skill | 41434 (35899–45414; n 10) | 36070 (31196–46108; n 10) | 1 (0–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | hit-repos-covered | fix-reaches-deploy | right-bump | no-unproven-safe | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 90% | 90% | 50% | 100% | 0% |

Spend: $12.02 across 10 attempts with cost telemetry; 10 attempts total.
