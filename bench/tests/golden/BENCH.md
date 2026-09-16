# PManager benchmark

Rendered by `bun run bench/bench.ts report` from `bench/results/history.jsonl`. Numbers are comparable only within one harness and model.

## Latest agent runs

| Harness | Model | Scenario | Score | Δ score | Failed | Duration | Δ duration | Tokens in/out | Cache r/w | Δ tokens | Cost | Turns | Tool calls | Date | Sha |
| :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- | :--- |
| claude-code 2.1.272 | claude-sonnet-5 | perf-bug-new-epic | 1.00 | — | — | 60s | — | 5000/400 | 3000/100 | — | $0.42 | 12 | Bash 7, Read 4 | 2026-09-15 | abc1234 |
| codex 0.154.0 | gpt-5.4 | perf-bug-new-epic | 0.50 | +0.25 | non-goals | 60s | -30s | 1000/100 | 0/0 | +0 | — | — | command_execution 3 | 2026-09-15 | abc1234 |

## Tool microbench

| Epics | Tasks | Iterations | status median/max | Δ | check median/max | Δ | render median/max | Δ | Date | Sha |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| 50 | 1000 | 5 | 90/110 ms | -10 ms | 300/345 ms | +0 ms | 200/230 ms | +0 ms | 2026-09-15 | abc1234 |

## History (last 20 agent runs)

| Date | Sha | Harness | Model | Scenario | Run | Score | Failed | Duration | Tokens in/out | Cost |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: |
| 2026-09-15 | abc1234 | claude-code | claude-sonnet-5 | perf-bug-new-epic | 1 | 1.00 | — | 60s | 5000/400 | $0.42 |
| 2026-09-15 | abc1234 | codex | gpt-5.4 | perf-bug-new-epic | 1 | 0.50 | non-goals | 60s | 1000/100 | — |
| 2026-09-14 | 0000000 | codex | gpt-5.4 | perf-bug-new-epic | 1 | 0.25 | non-goals | 90s | 1000/100 | — |
