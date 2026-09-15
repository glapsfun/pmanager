# Commands — the pm tool

All commands run from the orchestration repo root (any subdirectory works;
the tool finds the git root). Prefix every invocation with the absolute path
of this skill folder:

    bun run <skill-dir>/scripts/pm.ts <command> [args] [flags]

`<skill-dir>` is the directory containing this `references/` folder. On
Claude Code plugin installs it is `${CLAUDE_PLUGIN_ROOT}/skills/pmanager`;
on `npx skills` installs it is wherever the skill was copied. Below, `pm`
stands for that full prefix.

## Preflight (every run, Phase 0)

1. `bun --version` — if it fails, print to the user:
   "PManager's checker, renderer and claim commands need Bun (https://bun.sh).
   Install with: `curl -fsSL https://bun.sh/install | bash`, then restart the
   shell." Offer to run the install yourself. Do not run any other command
   below until Bun works. Continue planning without the tool only if the user
   says so; set the ledger line `Tool: unavailable (bun missing)`.
2. `pm status --harness <yours>` — read the output; it replaces the manual
   INDEX scan. `remote: none` or `remote: unreachable` → claims are
   unavailable this run; say so and set `Tool: ok, no remote`. Otherwise
   `Tool: ok`.

## Command table

| Command | When | Good result | On failure |
| :--- | :--- | :--- | :--- |
| `status [--json]` | Phase 0; status queries; before suggesting a task | exit 0; rows list epics, sessions, `[remote]`, `[stale]`, blocked tasks, `next:` | exit 2: not a git repo or no `docs/pm` — say so; a cold start is fine |
| `check [--json] [--stale-days N]` | Phase 6 before commit; every update run; after any hand edit | exit 0, `OK: no findings` or warnings only | exit 1: fix each finding at its file, rerun; never commit with errors; never edit rendered regions by hand |
| `render` | after writing or editing any epic/task/log file; after pulling `main` | exit 0; prints rendered paths or `nothing to render` | never fails on valid input; if it writes something unexpected, run `check` |
| `render --migrate` | `check` reports `W-LEG-001` or `E-RND-004` on pre-tool documents | prints `migrated <path>` lines, then rendered paths | ask the user before running it on a repo with a hand-maintained INDEX; it rewrites files |
| `claim <slug> --harness NAME` | Phase 4, right after the user approves the epic and `epic.md` is written | exit 0; you are now on branch `pm/<slug>`, pushed | exit 1 `owned by …`: stop, tell the user who owns it; exit 2: no remote or no epic file |
| `claim <slug> --takeover --harness NAME` | user explicitly asks to take over a stale claim | exit 0; plan changelog records the previous owner | exit 1 `not stale`: refuse; the user must ask the owner to release |
| `release <slug> --harness NAME` | user says "release …" or hands the epic to another session | exit 0; session cleared and pushed | exit 1 `owned by …, not <you>`: refuse — only the owning harness releases; the owner must release, or the user asks for `claim --takeover` (stale) or `release --force` (a deliberate override, recorded in the log and plan changelog). exit 1 `already unclaimed`; exit 2 no remote / no branch |
| `handoff <slug> <task-id>` | user says "pick up T03", "brief for T02 of …" | exit 0; the brief on stdout — paste it to the executing agent or user, write nothing | exit 2 unknown epic/task: check `status` for the right ids |

Always pass `--harness <name>` with your harness (`claude-code`, `pi`,
`codex`, `gemini-cli`, `copilot`); the default is only a guess.

## Phase 6 order (new epic) and every update run

1. Write/modify epic, plan (hand-written parts only), tasks.
2. Write the run log entry: `docs/pm/log/YYYY-MM-DD-<slug>-<6 hex>.md` with
   frontmatter `date`, `epic`, `harness`, `kind` (`spec` | `update`) and one
   line of body. Do not edit the memo changelog.
3. `pm render`, then `pm check`; fix findings; repeat until exit 0.
4. Commit on `pm/<slug>`: `git add docs/pm && git commit docs/pm -m "docs(pm): <what>"`.
5. `git push origin pm/<slug>` — the one push the skill may do.

## Rules the checker enforces

Structure E-STR-001…005, identity E-ID-001…003, references E-REF-001…004,
rendered views E-RND-001…004, state E-ST-001…004, claims E-CLM-001 /
W-CLM-001…002, legacy W-LEG-001. Each finding prints its fix. Passing means
the documents conform; it does not prove evidence, approval, or outcomes.
