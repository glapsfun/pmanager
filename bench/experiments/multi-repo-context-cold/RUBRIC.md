# multi-repo-context-cold: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-04-multi-repo-context-bench-design.md`.

## Question

Without project profiles, and with no target fact in the memo or in prior
epics, how often does a plan for a three-repo change get a target's facts
wrong?

## Per attempt

For each graded attempt, read `artifacts/<attempt>/docs-pm/` (epic, plan,
tasks) and the transcript (`raw.jsonl`), and record one row per check:

| Check | Verdict | Source |
| :--- | :--- | :--- |
| own-checks-webshop | pass / fail | where the fact came from |
| own-checks-infra | pass / fail | |
| own-checks-argocd | pass / fail | |
| no-manager-commands | pass / fail | |
| conventions | pass / fail | |
| cross-repo-order | pass / fail | |
| repos-registered | pass / fail | |

Also record **targets researched**: which targets the transcript's `pm research --repo` calls covered. `pm research` uses only the last `--repo` it is given, so a call naming three repos researched one; a miss on a target that was never researched is reported as such, not as a gap profiles would close.

**Verdict.** From reading the plan, not from the grader alone. Where the two
differ, the hand verdict stands and `NOTES.md` records the grader bug and
the re-grade.

**Source.** From the transcript: the agent opened the file that holds the
fact (`Makefile` or `README.md` in webshop, `AGENTS.md` or
`.github/workflows/ci.yml` in infra, `.github/workflows/validate.yml` or
`CONTRIBUTING.md` in argocd), or ran `pm research --repo` on that target and
the fact appears in its output. A pass with no traceable source is
"passed, source unclear". A fact traced to the memo or to a prior epic means
the fixture leaked; stop and fix the fixture before trusting the run.

## Cases the graders do not settle

- A task that tells someone to run `terraform plan` from a workstation fails `conventions`: infra's AGENTS.md forbids plan and apply from a workstation; the grader checks only apply.
- `kubectl apply --dry-run` is not a hand apply.
- A check named only in plan.md or epic.md (for example in the Definition of done) counts for a repo when it plainly applies to that repo's tasks; record "plan-level" as its source.
- One task that releases the webshop and bumps argocd's tag, followed by a separate traffic task that depends on it, passes `cross-repo-order` (the release still precedes the switch); note it.
- A grader verdict that lists unattributed tasks in its evidence is read by hand: place each task and re-grade.

## Exclusions

Harness or API failures (crash, API error) are excluded, and so is an attempt
whose plan is not in the fixture because the agent skipped `--no-worktree`
(its plan cannot be read). A timeout counts as failed. Fewer than 8 graded attempts makes the experiment inconclusive;
topping up is the user's call.

## Decision rule (copied from the design, fixed before the run)

Each of the seven checks is counted on its own, after the hand audit:

- At most one failing attempt: nothing is built for that check.
- Two or more failing: first, with the user's go-ahead, run the same request
  10 times on the full example (memo and story epics as they are, about
  $10) to see whether a memo the planner keeps itself already covers the
  gap. If it does, the follow-up is making the memo's per-project
  conventions dependable, not profiles. If it does not, the column below
  says what gets designed, and that design is rerun on this scenario with
  and without it.
- If every check passes: post the result on #16; part 2 waits until real
  planning shows a gap, and parts 3 and 4 are reconsidered on the same
  evidence.

| Check | Two or more failures lead to |
| :--- | :--- |
| own-checks-webshop | webshop's profile carries its commands |
| own-checks-infra | infra's profile carries its commands |
| own-checks-argocd | argocd's profile carries its CI checks |
| no-manager-commands | every profile carries its commands |
| conventions | profiles carry conventions |
| cross-repo-order | part 4 (relationship map) |
| repos-registered | a skill fix to how Phase 2 uses the catalog, not profiles |

## Also recorded

Fresh tokens, cost, duration and pre-framing context per attempt from the
experiment report, and the character count of `pm status` output on a
freshly built fixture (`PM_TODAY` 2026-09-15).
