# Experiment multi-stack-repo-cold-2

claude-code 2.1.321 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:2e5a036db08b0b68c75b03eab70fd35f0c1a04c94a0d99f19fe1826d73ba1be0) · repo e863392 (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 10 | 10 | 10 | — | 0% | 0.83 (0.79–0.88) | 447s | 51/40043 (10) | $11.37 (10) | $1.10 | 26 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 39238 (37226–45916; n 10) | 33628 (31908–35399; n 10) | 1 (0–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | own-checks-service | own-checks-terraform | own-checks-chart | no-borrowed-checks | resource-home | rollout-order | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 70% | 20% | 100% | 10% | 0% | 100% | 0% | 0% |

Spend: $11.37 across 10 attempts with cost telemetry; 10 attempts total.
