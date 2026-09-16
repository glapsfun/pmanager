# bench

Measures how effectively the pmanager skill does its job, on any harness with a headless mode.

- `bun run bench.ts run --harness <claude-code|codex|pi> [--model <id>] [--scenario <name>]... [--runs N] [--timeout-s N] [--keep]` runs the agent suite: each scenario builds a fixture repo, links the skill from this working tree into it, launches the harness with a fixed prompt, then scores the fixture with deterministic graders. Costs API money.
- `bun run bench.ts tool [--epics N] [--tasks N] [--iterations N]` times `status`, `check`, and `render` on a synthetic `docs/pm`. Free.
- `bun run bench.ts report` regenerates `BENCH.md` from `results/history.jsonl`.

Scores come only from disk. Tokens, cost, turns, and tool calls are recorded when the harness reports them and stored as `null` otherwise. Numbers are comparable only within one harness and model.

Credentials come from your environment: `ANTHROPIC_API_KEY` for Claude Code and pi (Anthropic models), `OPENAI_API_KEY` for Codex. Claude Code honours `CLAUDE_CODE_MAX_BUDGET_USD`. Raw harness output lands in `results/raw/` (gitignored). Commit `results/history.jsonl` and `BENCH.md` after a run you want to keep.

pi loads project skills only from trusted projects; set `defaultProjectTrust: always` in pi's settings for headless runs.

Gemini CLI and Copilot CLI have stub adapters that report why they are unavailable.

Design: `.docs/specs/2026-09-15-pmanager-benchmark-design.md` (local, not in git).
