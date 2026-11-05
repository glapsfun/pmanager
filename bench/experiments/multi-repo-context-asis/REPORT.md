# Experiment multi-repo-context-asis

claude-code 2.1.318 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:e25d9b2a5b03d7225479ae43cac8a4fa8ebc556984d205d61cc2e09f7c9598ef) · repo e817a05 (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-repo-context-asis | with-skill | 10 | 10 | 10 | — | 70% | 1.00 (0.96–1.00) | 461s | 55/42026 (10) | $13.67 (10) | $1.38 | 28 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| multi-repo-context-asis | with-skill | 69664 (56793–71283; n 7) | 58199 (50344–67865; n 7) | 0 (0–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | own-checks-webshop | own-checks-infra | own-checks-argocd | no-manager-commands | conventions | cross-repo-order | repos-registered |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-repo-context-asis | with-skill | 0% | 10% | 0% | 0% | 0% | 0% | 10% | 10% | 10% | 10% | 20% | 10% | 10% | 10% | 20% | 20% | 10% |

Spend: $13.67 across 10 attempts with cost telemetry; 10 attempts total.
