# PManager benchmark

Rendered by `bun run bench/bench.ts report` from `bench/results/history.jsonl`. Numbers are comparable only within one harness and model.

## Latest agent runs

| Harness | Model | Scenario | Score | Δ score | Failed | Duration | Δ duration | Tokens in/out | Cache r/w | Δ tokens | Cost | Turns | Tool calls | Date | Sha |
| :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- | :--- |
| claude-code 2.1.273 | — | two-session-claim-conflict | 1.00 | — | — | 41s | — | 12/2406 | 144387/23185 | — | $0.37 | 7 | Bash 4, Skill 1 | 2026-09-16 | c7fcbb6 |

## Tool microbench

| Epics | Tasks | Iterations | status median/max | Δ | check median/max | Δ | render median/max | Δ | Date | Sha |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| 50 | 1000 | 3 | 102/107 ms | — | 123/134 ms | — | 95/118 ms | — | 2026-09-16 | 0364fad |

## History (last 20 agent runs)

| Date | Sha | Harness | Model | Scenario | Run | Score | Failed | Duration | Tokens in/out | Cost |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: |
| 2026-09-16 | c7fcbb6 | claude-code | — | two-session-claim-conflict | 1 | 1.00 | — | 41s | 12/2406 | $0.37 |
