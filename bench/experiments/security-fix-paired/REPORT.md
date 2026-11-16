# Experiment security-fix-paired

claude-code 2.1.325 · model claude-sonnet-5 · 2 conditions · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:e264e4af924b04e599bf93308ea67f2d2aed3b7359e1be93617663c1e974f528) · repo de8d06e (clean) · isolation config-dir · baseline origin/main @ 11ec824

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 10 | 10 | 9 | harness-error 1 | 20% | 0.94 (0.88–0.94) | 571s | 86/54017 (9) | $16.12 (10) | $1.67 | 43 |
| security-fix | baseline-skill | 10 | 10 | 9 | harness-error 1 | 0% | 0.88 (0.88–0.88) | 456s | 60/39246 (9) | $11.62 (10) | $1.21 | 30 |

## Paired differences (with-skill minus baseline-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff | Cost diff median (IQR) | Duration diff median (IQR) | Steps diff median (IQR) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | 9 | 1 | +0.06 (+0.00–+0.06) | +22% | +0.69 (+0.23–+0.78) | +179s (+87s–+226s) | +16 (+4–+17; n 9) |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| security-fix | with-skill | 40657 (39294–41079; n 9) | 38662 (36123–40350; n 9) | 0 (0–1; n 9) |
| security-fix | baseline-skill | 37080 (31534–43085; n 9) | 33856 (29014–41978; n 9) | 0 (0–1; n 9) |

| Scenario | Context diff, with-skill minus baseline-skill (IQR; n) |
| :--- | ---: |
| security-fix | +3999 (+2092–+19510; n 9) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | hit-repos-covered | fix-reaches-deploy | right-bump | no-unproven-safe | repos-registered | no-manager-commands |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| security-fix | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 44% | 11% | 0% | 11% | 11% | 0% |
| security-fix | baseline-skill | 0% | 11% | 11% | 11% | 0% | 0% | 0% | 0% | 0% | 0% | 100% | 67% | 22% | 0% | 0% | 0% |

Spend: $27.73 across 20 attempts with cost telemetry; 20 attempts total.
