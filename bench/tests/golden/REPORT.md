# Experiment t

claude-code 9 · model m · 2 conditions · 3 pairs · timeout 10s · skill 0.2.0 (sha256:s) · repo abc (clean) · isolation fake

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| s | with-skill | 3 | 3 | 3 | — | 67% | 1.00 (0.75–1.00) | 0s | 10/5 (2) | $2.00 (2) |
| s | without-skill | 3 | 2 | 1 | timeout 1 | 0% | 0.50 (0.50–0.50) | 0s | 10/5 (1) | $3.00 (2) |

## Paired differences (with-skill minus without-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff |
| :--- | ---: | ---: | ---: | ---: |
| s | 1 | 2 | +0.50 (+0.50–+0.50) | +100% |

## Check failure rates over completed attempts

| Scenario | Condition | o1 | c1 |
| :--- | :--- | ---: | ---: |
| s | with-skill | 33% | 0% |
| s | without-skill | 100% | 0% |

Spend: $5.00 across 4 attempts with cost telemetry; 5 attempts total.
