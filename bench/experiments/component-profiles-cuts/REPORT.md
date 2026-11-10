# Experiment component-profiles-cuts

claude-code 2.1.322 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:cc6507c8dcd468e3c7fbaf5e2403e5236236d34fecf64df46ea08cbd80729681) · repo 1cf467a (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 10 | 10 | 10 | — | 80% | 1.00 (1.00–1.00) | 504s | 52/43583 (10) | $11.84 (10) | $1.18 | 26 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 40789 (38140–47075; n 10) | 33750 (32458–36056; n 10) | 1 (0–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | own-checks-service | own-checks-terraform | own-checks-chart | no-borrowed-checks | resource-home | rollout-order | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 20% | 0% | 10% | 0% | 0% |

Spend: $11.84 across 10 attempts with cost telemetry; 10 attempts total.
