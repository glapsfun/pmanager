# component-profiles-cuts: hand-audit rubric

Written before any run. One condition, `with-skill`: `feat/component-profiles` with the three cuts to the fix rounds that `../component-profiles-paired/NOTES.md` found (`1cf467a`):

- the research block prints a `plan:` line under a release link;
- a part's release command satisfies E-PRT-003;
- a command a make target runs (`go test ./...` for `make test`) counts, verbatim.

The comparison is the baseline arm of `component-profiles-paired` (main at `4ad8596`, median cost $1.01), which is not re-run. Scenario, fixture, timeout and model are as in that run. The grader is version 3.

## Question

Do the three cuts bring the change's median cost per planning run within +$0.15 of main's skill, with the quality the paired run measured?

## Per attempt

As in `../component-profiles-paired/RUBRIC.md`: the per-check table, rollout order per link, the cases the graders do not settle, the per change-arm items, the n/a and exclusion rules. Also the rulings in its `NOTES.md`: a check named at plan level counts when it plainly applies to the part's tasks; a repo-wide Definition of done is not a borrowed check. Also record, from the transcript:

- whether the first `pm record` reported E-REL-001 or E-REL-002 (the `plan:` line's effect);
- the `pm record` runs up to the first clean one, and each E-PRT-003 finding with the command the task named instead;
- the calls and cost from the first failing record to the next clean one, input-side as in the paired `NOTES.md`.

## Decision rule (fixed before the run)

Counted by hand:

- Ships when own-checks-chart, own-checks-service and rollout-order each fail in at most 1 of 10 attempts, and the median cost per run is at most $1.16 (the paired baseline arm's $1.01 plus $0.15).
- Otherwise: report which cut did not take (E-REL on first drafts, E-PRT-003 rounds, something new) and decide with the user.

Reported with no threshold: first drafts that E-REL fired on (paired run: 10 of 10), record rounds, duration and turns, against both arms of the paired run.

## Caveat

The baseline arm is not re-run, so drift between runs of the same skill is not controlled. The change arm's median in the paired run ($1.19, same scenario, without the cuts) is the second comparison.
