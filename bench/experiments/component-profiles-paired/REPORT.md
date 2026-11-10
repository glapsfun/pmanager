# Experiment component-profiles-paired

claude-code 2.1.321 · model claude-sonnet-5 · 2 conditions · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:4ce019e1c68f7d6c4ff1dd382467077e5ee2d73b9b2d963a16d6663c688b6e21) · repo b6b4ece (clean) · isolation config-dir · baseline 4ad8596 @ 4ad8596

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 10 | 10 | 10 | — | 40% | 0.94 (0.94–1.00) | 494s | 57/40602 (10) | $12.44 (10) | $1.19 | 29 |
| multi-stack-repo | baseline-skill | 10 | 10 | 10 | — | 0% | 0.83 (0.83–0.83) | 440s | 46/38188 (10) | $10.89 (10) | $1.01 | 23 |

## Paired differences (with-skill minus baseline-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff | Cost diff median (IQR) | Duration diff median (IQR) | Steps diff median (IQR) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | 10 | 0 | +0.14 (+0.11–+0.17) | +40% | +0.18 (-0.02–+0.37) | +70s (-60s–+86s) | +7 (+1–+10; n 10) |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 38848 (34285–40955; n 10) | 32147 (29124–35056; n 10) | 0 (0–0; n 10) |
| multi-stack-repo | baseline-skill | 40792 (35006–43868; n 10) | 32428 (29854–39808; n 10) | 0 (0–1; n 10) |

| Scenario | Context diff, with-skill minus baseline-skill (IQR; n) |
| :--- | ---: |
| multi-stack-repo | -181 (-8608–+6700; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | own-checks-service | own-checks-terraform | own-checks-chart | no-borrowed-checks | resource-home | rollout-order | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-stack-repo | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 60% | 0% | 0% | 0% | 0% |
| multi-stack-repo | baseline-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 80% | 20% | 100% | 0% | 0% | 100% | 0% | 0% |

Spend: $23.33 across 20 attempts with cost telemetry; 20 attempts total.
