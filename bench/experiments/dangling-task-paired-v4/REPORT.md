# Experiment dangling-task-paired-v4

claude-code 2.1.318 · model claude-sonnet-5 · 2 conditions · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:81a7f50c022bdc67ea83256c8ac65151f8d969c7b8746da3901a9a9aedcc042b) · repo e7aefcb (clean) · isolation config-dir · baseline 8e9723e @ 8e9723e

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-repo-context | with-skill | 10 | 10 | 10 | — | 40% | 0.94 (0.90–1.00) | 419s | 50/36279 (10) | $10.68 (10) | $1.05 | 25 |
| multi-repo-context | baseline-skill | 10 | 10 | 10 | — | 60% | 1.00 (0.94–1.00) | 419s | 45/37236 (10) | $10.38 (10) | $1.00 | 23 |

## Paired differences (with-skill minus baseline-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff | Cost diff median (IQR) | Duration diff median (IQR) | Steps diff median (IQR) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-repo-context | 10 | 0 | +0.00 (-0.09–+0.00) | -20% | +0.06 (-0.05–+0.19) | -8s (-18s–+60s) | +2 (-1–+6; n 10) |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| multi-repo-context | with-skill | 51002 (38865–57246; n 9) | 40702 (38254–45989; n 9) | 0 (0–1; n 10) |
| multi-repo-context | baseline-skill | 45879 (45296–48985; n 9) | 38989 (37397–41927; n 9) | 0 (0–0; n 10) |

| Scenario | Context diff, with-skill minus baseline-skill (IQR; n) |
| :--- | ---: |
| multi-repo-context | -3526 (-8382–+9987; n 8) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | own-checks-webshop | own-checks-infra | own-checks-argocd | no-manager-commands | conventions | cross-repo-order | repos-registered |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-repo-context | with-skill | 10% | 10% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 20% | 0% | 30% | 0% | 10% | 20% | 0% |
| multi-repo-context | baseline-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 10% | 10% | 0% | 10% | 20% | 0% |

Spend: $21.06 across 20 attempts with cost telemetry; 20 attempts total.
