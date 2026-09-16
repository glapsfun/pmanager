# PManager benchmark

Rendered by `bun run bench/bench.ts report` from `bench/results/history.jsonl`. Numbers are comparable only within one harness and model.

## Latest agent runs

| Harness | Model | Scenario | Score | Δ score | Failed | Duration | Δ duration | Tokens in/out | Cache r/w | Δ tokens | Cost | Turns | Tool calls | Date | Sha |
| :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- | :--- |
| claude-code 2.1.273 | claude-opus-5[1m] | feature-idea-epic | 1.00 | — | — | 294s | — | 36/20683 | 720178/52732 | — | $1.41 | 19 | Bash 16, Skill 1 | 2026-09-16 | 0ee8751 |
| claude-code 2.1.273 | claude-opus-5[1m] | perf-bug-new-epic | 1.00 | — | — | 261s | — | 30/17161 | 539575/50196 | — | $1.20 | 16 | Bash 13, Skill 1 | 2026-09-16 | 0ee8751 |
| claude-code 2.1.273 | claude-opus-5[1m] | tracking-update-memory | 1.00 | — | — | 97s | — | 18/5107 | 246566/28676 | — | $0.54 | 10 | Bash 7, Skill 1 | 2026-09-16 | 0ee8751 |
| claude-code 2.1.273 | claude-opus-5[1m] | two-session-claim-conflict | 1.00 | +0.00 | — | 40s | +0s | 12/2345 | 144159/23409 | -61 | $0.37 | 7 | Bash 4, Skill 1 | 2026-09-16 | 0ee8751 |
| codex 0.154.0 | — | feature-idea-epic | 1.00 | — | — | 174s | — | 27028/8688 | 202624/0 | — | — | — | command_execution 11, file_change 1 | 2026-09-16 | 2569592 |
| codex 0.154.0 | — | perf-bug-new-epic | 1.00 | — | — | 200s | — | 29465/9724 | 318720/0 | — | — | — | command_execution 18, file_change 1 | 2026-09-16 | 2569592 |
| codex 0.154.0 | — | tracking-update-memory | 1.00 | — | — | 72s | — | 23896/1931 | 128256/0 | — | — | — | command_execution 10 | 2026-09-16 | 2569592 |
| codex 0.154.0 | — | two-session-claim-conflict | 1.00 | +0.25 | — | 47s | +1s | 22431/1557 | 142080/0 | +830 | — | — | command_execution 9 | 2026-09-16 | 2569592 |

## Tool microbench

| Epics | Tasks | Iterations | status median/max | Δ | check median/max | Δ | render median/max | Δ | Date | Sha |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| 50 | 1000 | 3 | 102/107 ms | — | 123/134 ms | — | 95/118 ms | — | 2026-09-16 | 0364fad |

## History (last 20 agent runs)

| Date | Sha | Harness | Model | Scenario | Run | Score | Failed | Duration | Tokens in/out | Cost |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: |
| 2026-09-16 | 2569592 | codex | — | two-session-claim-conflict | 1 | 1.00 | — | 47s | 22431/1557 | — |
| 2026-09-16 | 2569592 | codex | — | tracking-update-memory | 1 | 1.00 | — | 72s | 23896/1931 | — |
| 2026-09-16 | 2569592 | codex | — | feature-idea-epic | 1 | 1.00 | — | 174s | 27028/8688 | — |
| 2026-09-16 | 2569592 | codex | — | perf-bug-new-epic | 1 | 1.00 | — | 200s | 29465/9724 | — |
| 2026-09-16 | 0ee8751 | claude-code | claude-opus-5[1m] | two-session-claim-conflict | 1 | 1.00 | — | 40s | 12/2345 | $0.37 |
| 2026-09-16 | 0ee8751 | claude-code | claude-opus-5[1m] | tracking-update-memory | 1 | 1.00 | — | 97s | 18/5107 | $0.54 |
| 2026-09-16 | 0ee8751 | claude-code | claude-opus-5[1m] | feature-idea-epic | 1 | 1.00 | — | 294s | 36/20683 | $1.41 |
| 2026-09-16 | 0ee8751 | claude-code | claude-opus-5[1m] | perf-bug-new-epic | 1 | 1.00 | — | 261s | 30/17161 | $1.20 |
| 2026-09-16 | 6973336 | codex | — | two-session-claim-conflict | 1 | 0.75 | names-owner | 46s | 21275/1883 | — |
| 2026-09-16 | c7fcbb6 | claude-code | claude-opus-5[1m] | two-session-claim-conflict | 1 | 1.00 | — | 41s | 12/2406 | $0.37 |
