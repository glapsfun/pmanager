# Experiment m0-null

claude-code 2.1.283 · model claude-sonnet-5 · 2 conditions · 3 pairs · timeout 900s · skill 0.5.0 (sha256:f1616d1130d8299c5e7449bd5a93809936c0f0be8e606ca7e61453c5c044682d) · repo cfe7f78 (dirty) · isolation config-dir · baseline main @ ac5b9f2

**Preliminary**: fewer than 10 completed pairs.

## Per scenario and condition

| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) |
| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 3 | 3 | 3 | — | 100% | 1.00 (1.00–1.00) | 291s | 58/24855 (3) | $2.74 (3) |
| perf-bug-new-epic | baseline-skill | 3 | 3 | 3 | — | 100% | 1.00 (1.00–1.00) | 253s | 54/22097 (3) | $2.64 (3) |
| feature-idea-epic | with-skill | 3 | 3 | 3 | — | 33% | 0.92 (0.88–0.96) | 276s | 50/24396 (3) | $2.75 (3) |
| feature-idea-epic | baseline-skill | 3 | 3 | 3 | — | 100% | 1.00 (1.00–1.00) | 285s | 50/23982 (3) | $2.54 (3) |

## Paired differences (with-skill minus baseline-skill)

| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff |
| :--- | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | 3 | 0 | +0.00 (+0.00–+0.00) | +0% |
| feature-idea-epic | 3 | 0 | -0.08 (-0.12–-0.04) | -67% |

## Pre-framing context

Context: tokens on the call that made the first docs/pm write, minus the first call. Tool output: characters received before that write. Pre-research calls: tool calls on the fixture before the first pm research.

| Scenario | Condition | Context median (IQR; n) | Tool output median (IQR; n) | Pre-research calls median (IQR; n) |
| :--- | :--- | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 39335 (38687–40004; n 3) | 39975 (39708–40187; n 3) | 1 (1–1; n 3) |
| perf-bug-new-epic | baseline-skill | 31231 (31229–38980; n 3) | 36925 (34300–46233; n 3) | 2 (1–5; n 3) |
| feature-idea-epic | with-skill | 28277 (27438–30473; n 3) | 30800 (29164–38317; n 3) | 1 (1–2; n 3) |
| feature-idea-epic | baseline-skill | 25246 (24619–25285; n 3) | 26365 (25922–29293; n 3) | 1 (1–1; n 3) |

| Scenario | Context diff, with-skill minus baseline-skill (IQR; n) |
| :--- | ---: |
| perf-bug-new-epic | +6807 (-293–+8127; n 3) |
| feature-idea-epic | +3031 (+2153–+5854; n 3) |

## Check failure rates over completed attempts

| Scenario | Condition | scoped-diff | committed | check-no-errors | index-present | memo-present | log-entry | epic-and-plan | tasks-min-3 | binary-acceptance | evidence-cites-repo | metric-has-target | non-goals | draft-awaits-approval | riskiest-first | confidence-not-high |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| perf-bug-new-epic | with-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — |
| perf-bug-new-epic | baseline-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — |
| feature-idea-epic | with-skill | 0% | 33% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | 67% | 0% | 0% | — | 0% |
| feature-idea-epic | baseline-skill | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% | — | 0% | 0% | 0% | — | 0% |

Spend: $10.67 across 12 attempts with cost telemetry; 12 attempts total.
