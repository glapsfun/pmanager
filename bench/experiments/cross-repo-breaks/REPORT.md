# Experiment cross-repo-breaks

claude-code 2.1.330 · model claude-sonnet-5 · 1 condition · 10 pairs · timeout 1500s · skill 0.11.0 (sha256:0e1628a12d4d6569c054b4ec7d6bfb02ccc62f4d57a25e722e74a0508fd33b46) · repo a1353d9 (clean) · isolation config-dir

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) | Cost median | Steps median |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cross-repo-endpoint | with-skill | 10 | 10 | 10 | — | 90% | 1.00 (1.00–1.00) | 438s | 57/39158 (10) | $16.41 (10) | $1.15 | 29 |
| cross-repo-output | with-skill | 10 | 10 | 10 | — | 90% | 1.00 (1.00–1.00) | 412s | 47/37830 (10) | $11.52 (10) | $1.01 | 24 |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| cross-repo-endpoint | with-skill | 43982 (41693–51115; n 10) | 41994 (38059–46862; n 10) | 0 (0–1; n 10) |
| cross-repo-output | with-skill | 37978 (16794–40548; n 9) | 36505 (16308–40897; n 9) | 1 (0–1; n 10) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | draft-awaits-approval | client-covered | client-safe-rollout | consumer-covered | switch-order |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cross-repo-endpoint | with-skill | 0% | 10% | 0% | 0% | 0% | 10% | 10% | 10% | 10% | 10% | 10% | 10% | — | — |
| cross-repo-output | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | — | 0% | 10% |

Spend: $27.94 across 20 attempts with cost telemetry; 20 attempts total.
