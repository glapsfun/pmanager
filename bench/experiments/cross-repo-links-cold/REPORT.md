# Experiment cross-repo-links-cold

claude-code 2.1.327 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:56397b604e9b12aedc56be28ca8b26440c941b4e7728f8c67cfc204758488e81) · repo c2596de (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cross-repo-endpoint | with-skill | 10 | 10 | 10 | — | 70% | 1.00 (0.94–1.00) | 452s | 53/38379 (10) | $12.82 (10) | $1.13 | 27 |
| cross-repo-output | with-skill | 10 | 10 | 10 | — | 80% | 1.00 (1.00–1.00) | 393s | 53/33755 (10) | $11.28 (10) | $1.04 | 27 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| cross-repo-endpoint | with-skill | 44411 (39295–46932; n 10) | 38191 (36301–41164; n 10) | 1 (0–1; n 10) |
| cross-repo-output | with-skill | 40642 (38610–53183; n 10) | 41453 (38144–49025; n 10) | 1 (0–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | client-covered | client-safe-rollout | consumer-covered | switch-order |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cross-repo-endpoint | with-skill | 10% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 20% | — | — |
| cross-repo-output | with-skill | 10% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | — | 0% | 10% |

Spend: $24.09 across 20 attempts with cost telemetry; 20 attempts total.
