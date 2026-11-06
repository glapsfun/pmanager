# dangling-task-paired-v4: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-05-dangling-task-check-design.md`. Prior runs: `../multi-repo-context-cold/NOTES.md`, `../multi-repo-context-asis/NOTES.md`.

## Question

The cold scenario's traffic switch skipped the webshop version change in 3 of 10 runs, and four of the five such failures across the cold and as-is runs had a first-milestone task that nothing depended on. With `E-REF-005` (a first-milestone task no task depends on, reported by `pm record` and `pm check --epic` for an unstarted plan, as an error), does that gap close?

Conditions, same day and same claude-code version: `with-skill` is the skill with the rule (repo `e7aefcb`); `baseline-skill` is main's skill at `8e9723e` (`sha256:e25d9b2a...`, the skill both earlier runs used). Scenario `multi-repo-context`, grader version 4, which re-grades the twenty earlier plans exactly as they were read by hand and picks the real traffic task in each. (The first id, `dangling-task-paired`, was retired unrun when the final review moved the grader from version 3 to 4.)

## Per attempt, both conditions

For each graded attempt, read `artifacts/<attempt>/docs-pm/` (epic, plan, tasks) and the transcript (`raw.jsonl`), and record one row per check:

| Check | Verdict | Source |
| :--- | :--- | :--- |
| own-checks-webshop | pass / fail | where the fact came from |
| own-checks-infra | pass / fail | |
| own-checks-argocd | pass / fail | |
| no-manager-commands | pass / fail | |
| conventions | pass / fail | |
| cross-repo-order | pass / fail | |
| repos-registered | pass / fail | |

Also record the targets researched (the last `--repo` of each `pm research` call; #53).

**Verdict.** From reading the plan, not from the grader alone. Where the two differ, the hand verdict stands and `NOTES.md` records the grader bug and the re-grade.

**Source.** As in the cold rubric: the agent opened the file that holds the fact (`Makefile` or `README.md` in webshop, `AGENTS.md` or `.github/workflows/ci.yml` in infra, `.github/workflows/validate.yml` or `CONTRIBUTING.md` in argocd), or ran `pm research --repo` on that target and the fact appears in its output. A pass with no traceable source is "passed, source unclear". The fixture's memo and epics hold no target fact, so a fact traced there is a fixture bug.

For `cross-repo-order`, also record whether the plan states the release-before-switch order anywhere in its text.

## Per with-skill attempt, the rule

- Whether `E-REF-005` appeared in any `pm record` or `pm check` result in `raw.jsonl`, and the task and milestone it named.
- What the planner did next: which task it added to which task's `depends-on`, or which milestone it moved the task to, or something else.
- Whether the plan it finally recorded passes `cross-repo-order` by hand, and whether the edge it added is the one that made it pass.
- The tool calls and cost from the first `E-REF-005` to the clean record (from the transcript's usage).

A baseline attempt cannot see the rule; for each, record whether its final plan would have fired it (offline, `check` with `epic` set to its slug).

## Cases the graders do not settle

- A task that tells someone to run `terraform plan` from a workstation fails `conventions`.
- `kubectl apply --dry-run` is not a hand apply.
- A check named only in plan.md or epic.md counts for a repo when it plainly applies to that repo's tasks; record "plan-level".
- One task that releases the webshop and bumps argocd's tag, followed by a separate traffic task that depends on it, passes `cross-repo-order`; note it.
- A grader verdict listing unattributed tasks is read by hand.
- An attempt whose epic is not on the fixture's checked-out branch at the end (for example after `pm release` and `git checkout main`) is graded from its last `pm record` bundle in the transcript when that bundle holds the whole plan, as as-is p9 was.

## Exclusions

Harness or API failures (crash, API error) are excluded, and so is an attempt whose plan cannot be read. A timeout counts as failed. Fewer than 8 graded attempts in either condition makes the experiment inconclusive; topping up is the user's call.

## Decision rule (copied from the design, fixed before the run)

Counted by hand on `cross-repo-order`. The third branch is checked first: a baseline arm with at most 1 failure makes the run inconclusive whatever the rule arm shows; the rule arm's firings and fixes are still reported.

- Rule arm at most 1 failure and baseline arm 2 or more: the rule ships. #16 part 4 is reconsidered on this evidence.
- Rule arm 2 or more: read how the error was fixed. If planners moved tasks to another milestone instead of adding edges, the hint is revised and the rule arm rerun; otherwise the rule is dropped.
- Baseline arm at most 1: the gap did not reproduce; inconclusive, and topping up or shipping anyway is the user's call.

The other six checks, cost and duration are reported for both arms with no threshold: the rule must not make them noticeably worse.

## Also recorded

Fresh tokens, cost, duration and pre-framing context per attempt and per condition, from the experiment report.
