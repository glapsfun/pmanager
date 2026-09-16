# bench

Measures how effectively the pmanager skill does its job, on any harness with a headless mode.

- `bun run bench.ts run --harness <claude-code|codex|pi> [--model <id>] [--scenario <name>]... [--runs N] [--timeout-s N] [--keep]` runs the agent suite: each scenario builds a fixture repo, links the skill from this working tree into it, launches the harness with a fixed prompt, then scores the fixture with deterministic graders. Costs API money.
- `bun run bench.ts tool [--epics N] [--tasks N] [--iterations N]` times `status`, `check`, and `render` on a synthetic `docs/pm`. Free.
- `bun run bench.ts report` regenerates `BENCH.md` from `results/history.jsonl`.

Scores come only from disk. Token columns use one definition on every harness: `input` is the uncached part of the prompt, cache reads and writes are separate (Codex reports cached tokens inside its input count, so the adapter subtracts them). Tokens, cost, turns, and tool calls are recorded when the harness reports them and stored as `null` otherwise. Numbers are comparable only within one harness and model.

Credentials come from your environment: `ANTHROPIC_API_KEY` for Claude Code and pi (Anthropic models), `OPENAI_API_KEY` for Codex. Claude Code honours `CLAUDE_CODE_MAX_BUDGET_USD`. `bench run` only checks that the harness binary is installed; an unauthenticated harness shows up as a score-0 run whose `run-completed` check failed, with the reason in the raw log. Raw harness output lands in `results/raw/` (gitignored). Commit `results/history.jsonl` and `BENCH.md` after a run you want to keep.

pi loads project skills only from trusted projects; set `defaultProjectTrust: always` in pi's settings for headless runs.

## Experiments

An experiment pairs attempts on one harness and one model, optionally with and without the skill.

    bun run bench.ts experiment new --id pilot-1 --harness claude-code --model claude-sonnet-5 --condition both --pairs 2 --scenario perf-bug-new-epic
    bun run bench.ts experiment run --id pilot-1          # dry run: prints the plan and estimated cost, exit 3
    bun run bench.ts experiment run --id pilot-1 --yes    # spends money; resumable
    bun run bench.ts experiment report --id pilot-1

Both conditions get the same fixture plus a generated `docs/pm/CONTRACT.md` describing the document format; only the with-skill condition gets the activation sentence and the skill copy. Codex experiments must pass `--model` and `--reasoning` explicitly; both are recorded in the manifest and passed on the command line so the run never follows the local config. Manifest, attempts, and `REPORT.md` are committed under `experiments/<id>/`; `artifacts/` is kept locally.

Gemini CLI and Copilot CLI have stub adapters that report why they are unavailable.

Design: `.docs/specs/2026-09-15-pmanager-benchmark-design.md` (local, not in git).
