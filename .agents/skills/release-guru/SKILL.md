---
name: release-guru
description: Prepare, check, publish and verify a pmanager release (vX.Y.Z tag plus GitHub release) for the maintainer. Use when asked to prepare, resume, publish, verify or abandon a pmanager release, or to create the baseline release. Not for planning work; that is the pmanager skill.
---

# release-guru

Releases pmanager from this repository. Run `bun run release <command>` from the repo root. The helper does every deterministic step and prints one JSON result with `code` (0 done, 1 blocked or failed, 2 usage, 3 pending), `phase`, `message`, `next` and `blockers`. Your part is what it cannot do: notes users can read, the summary for the maintainer, and asking before anything is published. The full runbook is `RELEASING.md` at the repo root.

## Rules

- Start every session with `bun run release status` and follow its `next`. The saved state and GitHub say where the release is, not your memory.
- Before `publish`, `abandon` or `baseline`, read `git config user.name` and run `gh auth status`. If the active account differs, run `gh auth switch --user <name>` and check `gh auth status` again.
- Never use `--admin`, `--no-verify` or `--force`. Never move or delete a tag. Never edit `.release-guru/state.json` by hand.
- Report the helper's outcome as it is: `blocked` is not done, and `published-verify-failed` is published but not successful.
- The steps are the same in Claude Code and Codex, so one session can prepare and another can finish.
- `wait`, `publish`, `verify` and `check --foreground` can run for minutes. `publish` and `verify` need a shell timeout of at least 10 minutes: `publish` ends by running verify, and no flag keeps verify short. Keep `wait` inside your shell timeout with `bun run release wait --timeout <seconds>`, and leave room for verify in `bun run release publish --tree <tree> --wait <seconds>`. Running a step again is always safe.

## Steps

1. **Prepare.** `bun run release prepare`, or `bun run release prepare --version X.Y.Z` when the maintainer names a version. It creates `release/vX.Y.Z` from `origin/main`, bumps both plugin manifests, commits, and drafts notes in `.release-guru/notes.md`. Nothing is pushed.
2. **Write the notes.** Rewrite each line in plain words for people who use pmanager. Keep every `(#N)` or commit citation. When there is a Breaking section, replace the Migration `TODO` with what users must do.
3. **Check.** `bun run release check` starts the gate and the paid agent e2e in the background and returns at once. Then run `bun run release wait --timeout <seconds>`, with a value below your shell timeout (500 with a 10-minute one), until it stops returning code 3. The paid run costs money, so run it once per candidate.
4. **Summary.** `bun run release summary`, then show the maintainer the text in `data.summary`.
5. **Approval.** Publish only after the maintainer says yes to that summary, or when the request already asked to publish and the summary lists no blockers. Any change to the candidate means new checks, a new summary and a new yes.
6. **Publish.** `bun run release publish --tree <tree>` with the tree from the summary. It pushes the branch, opens the PR, waits for CI, merges, tags, creates the GitHub release and verifies the install routes. Code 3 means CI is still running: run the same command again.
7. **Verify.** Publish ends by verifying. `bun run release verify` runs it again on its own.

## When something goes wrong

- Blockers name what to fix. Fix them, then rerun the step.
- `main` moved, a PR check failed, or the candidate changed: `bun run release abandon`, then prepare again.
- `published-verify-failed`: the release is out. Find the cause, fix it, rerun `bun run release verify`. A fix to the released files is a new patch release; the tag stays where it is.
- `vX.Y.Z already exists on <commit>`, or `the merge commit's tree differs`: `bun run release abandon`, then prepare with `--version` above that version.
- `prepare` says `origin/main` already carries a version: it was bumped by hand; prepare with `--version` above it.
- `GitHub blocks the merge although checks passed`: tell the maintainer. They resolve it on the PR page, or merge it there with a merge commit; then run publish again.
- `status` reports `verify has not run`: run `bun run release verify`. `prepare` refuses until it has run.
- `abandon` says it left a PR or branch alone, or `prepare` names a release in progress that `abandon` cannot find: tell the maintainer. It was made somewhere else, or release-guru cannot tell it is this candidate's. If nobody needs it, the maintainer closes the PR or deletes the branch on GitHub.
- Interrupted anywhere: `bun run release status`, then the step it names. Each step checks what already exists before it writes.

## Baseline

Once, before the first regular release: `bun run release baseline --commit <sha>` tags an already merged commit as the starting version, using the CI already recorded for it. It publishes, so it needs the maintainer's yes like `publish`.
