# Releasing pmanager

This is the maintainer's runbook. The `release-guru` skill (`.agents/skills/release-guru/`, also linked from `.claude/skills/`) follows it from Claude Code or Codex: ask "Use release-guru to prepare the next pmanager release". Every step is a `bun run release <command>` call that you can also run yourself.

## What a release is

- An annotated git tag `vX.Y.Z` (message `pmanager vX.Y.Z`) on the merge commit of the release PR on `main`.
- A GitHub release with the same name, the release notes as its body, marked latest. No files are attached: every install route reads this repository.
- The version lives in `plugins/pmanager/.claude-plugin/plugin.json` and `plugins/pmanager/.codex-plugin/plugin.json`, which must match. The `tool`, `bench`, `ci` and `release` packages have no versions.
- Only changes under `plugins/pmanager/` and `.claude-plugin/marketplace.json` reach users. With none since the last tag, there is nothing to release.
- No prerelease tags: a plain `gskill add` picks the highest tag, prereleases included.

## How users get a release

Checked on 2026-11-02 with claude 2.1.316, codex 0.166.0 and gskill 0.8.0, in throwaway config folders.

| Route | What decides an update | Without a pin | Pin |
| :--- | :--- | :--- | :--- |
| Claude Code marketplace | the `version` in plugin.json | a fresh install takes `main`; an existing one changes only when the version does | `claude plugin marketplace add glapsfun/pmanager@vX.Y.Z` |
| Codex marketplace | the git revision | `codex plugin marketplace upgrade` takes `main`, version or not | `codex plugin marketplace add https://github.com/glapsfun/pmanager --ref vX.Y.Z` |
| gskill | semver git tags | the highest tag | `gskill add github.com/glapsfun/pmanager --skill pmanager --version X.Y.Z` |
| `npx skills` | not checked | `main` | not checked |

So for Claude Code users a release arrives when the version bump merges to `main`, and the tag follows right after. `main` stays "latest"; the tags are for people who want a fixed version.

## Version rules

Each commit since the last tag that touches the shipped paths counts, by its subject (`type(scope)!: message`):

- Below 1.0: a breaking change (`!`, or `BREAKING CHANGE:` in the body) or a `feat` bumps the minor version; anything else bumps the patch.
- From 1.0: breaking bumps major, `feat` bumps minor, anything else bumps the patch.

`prepare --version X.Y.Z` overrides the proposal. It must be newer than the last tag and than the version `origin/main` already carries; `prepare` refuses to release a version again or to lower one.

## Before you start

- `bun run setup` has been run, and you are on a clean checkout.
- `gh auth status` shows the same account as `git config user.name` (`gh auth switch --user <name>` if not).
- The pinned `claude` and `codex` CLIs are installed (`bun ci/gate.ts install-clis`). For `check --agent-e2e`, they also need the credentials the paid agent e2e uses.
- The `v*` tag ruleset exists on GitHub (no deletion, no update). `publish` and `baseline` refuse to run without it.

## Steps

1. `bun run release status` shows where a release stands and what to do next. Start here every time.
2. `bun run release prepare` creates `release/vX.Y.Z` from `origin/main`, bumps both manifests, commits `chore(release): vX.Y.Z`, and drafts notes in `.release-guru/notes.md` from the shipped commits, each citing its PR or commit. Nothing is pushed.
3. Rewrite the notes for users. Keep the citations; fill the Migration section when something breaks.
4. `bun run release check` runs the full gate (`bun ci/gate.ts pre-push`) in the background. The paid agent e2e is off by default, because it can take hours: the summary and the PR then show it as `skipped`. `bun run release check --agent-e2e` runs it after the gate (3 runs of each scenario, Claude Code blocking and capped at 10 USD per run, Codex report-only). Once it has run, a failure blocks the release. It writes its history and report into `.release-guru/agent-e2e/`, not into the tracked bench files. `--foreground` runs the same checks in the terminal.
5. `bun run release wait` returns when the checks finish, or after `--timeout` seconds (default 540) with code 3. `wait`, `publish`, `baseline`, `verify` and `check --foreground` can run for minutes. `publish`, `baseline` and `verify` need a shell timeout of at least 10 minutes, since `publish` and `baseline` end by running verify and no flag keeps verify short. Smaller `--timeout` and `--wait` values keep the waiting parts shorter, with more reruns.
6. `bun run release summary` writes `.release-guru/summary.md`: version, previous tag, branch, commit, tree, notes, check results, distribution changes and blockers, ending with the publish command.
7. Read the summary. Publishing is one yes for the whole of step 8.
8. `bun run release publish --tree <tree>` pushes the branch, opens the PR (notes plus a "Release checks" section), waits for the required checks, merges with a merge commit, checks that the merge commit's tree equals the checked tree, tags it, creates the GitHub release and runs verify. Code 3 means it is still waiting for CI: run it again.
9. `bun run release verify` checks the tag and release on GitHub, then installs the tag through Claude Code, Codex and gskill in throwaway config folders and compares the installed files with the tag. Each install command gets 5 minutes; one that takes longer is stopped and fails its route. It never touches your own `~/.claude` or `~/.codex`.

Check results are bound to the git tree, not the commit. `main` only takes up-to-date PRs merged with a merge commit, so the merge commit has the same tree as the checked branch. If the trees differ, nothing is tagged.

## States and recovery

| Phase | Meaning | Next |
| :--- | :--- | :--- |
| `prepared` | branch and notes exist locally | write the notes, `check` |
| `blocked` | a check failed or something changed | fix and `check` again, or `abandon` |
| `checked` | gate passed for this tree, and agent e2e passed or was skipped | `summary`, then `publish --tree` after a yes |
| `publishing` | some of the publish steps are done | `publish --tree` again |
| `published` | tag and release exist; verify passed, or `status` reports `verify has not run` | done, or `verify` |
| `published-verify-failed` | the release is out, an install route failed | find the cause, `verify` again |

- Every command first compares the saved state (`.release-guru/state.json`, git-ignored) with git and GitHub; what exists wins. A step that is already done and matches is skipped, so reruns never make a second PR, tag or release.
- A tag or release that exists but does not match stops the run with the reason.
- Only one command that writes runs at a time (a lock in `.release-guru/`); while checks run, the others wait.
- `bun run release abandon` drops a candidate that was never published: it closes the PR, deletes the release branch locally and on origin, and clears the state. It leaves alone, and names, a PR or branch it cannot tell is this candidate's: one that points at another commit and is not the PR `publish` recorded for it. PRs from forks are never treated as release PRs. It refuses when this candidate is published, or when its merged PR can still be tagged by `publish`.
- `main` moved during the PR, or a PR check failed: abandon and prepare again, since the tree changes.
- A published tag never moves; the ruleset enforces it. A mistake is fixed by a new patch release whose notes say what it corrects.

## When a release is stuck

| Message | Cause | Way out |
| :--- | :--- | :--- |
| `vX.Y.Z already exists on <commit>` | the version is taken on origin by another commit | `abandon`, then `prepare --version` above it |
| `the merge commit's tree differs from the checked tree` | the PR merged, but not as checked; main carries the version bump without a tag | `abandon`, then `prepare --version` above it |
| `origin/main already says X.Y.Z` | the version was bumped by hand on main | `prepare --version` above it |
| `GitHub blocks the merge although checks passed` | a rule beyond the required checks holds the PR | resolve it on the PR page, or merge it there with a merge commit, then `publish --tree` again |
| `verify has not run` or `published-verify-failed` | verify was interrupted, or an install route failed | `verify`; a fix to the released files is a new patch release. `prepare` refuses until verify has run |
| `left alone` from `abandon`, or `another release is in progress` from `prepare` with nothing to abandon | a PR or branch made on another machine, or one release-guru cannot tell is this candidate's | `abandon` it where it was prepared; if nobody needs it, close it on GitHub, or delete the branch there |

## Baseline

The first tag marks a version that already shipped. `bun run release baseline --commit <sha>` checks that the commit is on `main`, that both manifests agree there, and that every CI check recorded for it passed. It then tags it, creates a short release, and verifies. It runs once: it refuses when any other `v*` tag exists. For pmanager the baseline is `v0.10.0` on `9520e6b` (the merge of #20).

## What is validated, and how

- **Deterministic tests**, in the gate (`.agents/skills/release-guru/tests`). They use local git repositories in place of GitHub and an in-memory stand-in for `gh`. They cover version rules, notes, preflight, prepare, abandon, checks, summary, publish with every interruption and conflict, verify, and baseline.
- **Live harness check**, run once by hand: prepare in Claude Code, resume in Codex, stop before publishing. Its result is recorded here after it runs.
- **Report-only**: the Codex agent e2e results are shown but do not block.
- **Not validated**: the release flow against real GitHub before the baseline; whether Codex refreshes marketplaces on its own at startup; the `npx skills` route.

`gskill` finds skills anywhere in a repository, so `gskill add github.com/glapsfun/pmanager --skill release-guru` would install this skill. It is a maintainer tool for this repository and is not part of the plugin.
