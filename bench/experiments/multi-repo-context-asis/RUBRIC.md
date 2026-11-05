# multi-repo-context-asis: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-04-multi-repo-context-bench-design.md` (decision rule). Prior run: `../multi-repo-context-cold/NOTES.md`.

## Question

The cold run failed `cross-repo-order` in 3 of 10 attempts (p7, p9, p10): the 10% traffic task did not depend on the webshop version change. On the workspace as the story leaves it, with the memo the planner kept, does that gap close?

The manager's `main` holds the finished `webshop-healthcheck` epic and a memo whose conventions name webshop's and argocd's checks and say "`webshop` to `argocd`: a release reaches the cluster only when `newTag` is bumped in `workloads/webshop/kustomization.yaml`". Infra's conventions are not in `main`'s memo; they are on the in-flight `staging-environment` epic's branch. The stakeholder rows say "PR review in webshop" and "PR review in argocd", as the story wrote them.

## Per attempt

Same as the cold rubric: for each graded attempt, read `artifacts/<attempt>/docs-pm/` and `raw.jsonl`, and record one row per check (verdict from reading the plan, plus source) and the targets researched.

Sources now include, besides the target repos and `pm research`:

- `memo`: the agent read `pmanager-memo.md` (or `pm status`, which prints it) and the fact is there;
- `healthcheck epic`: the agent read `docs/pm/webshop-healthcheck/`;
- `staging epic`: the agent read the staging epic's branch or worktree.

For `cross-repo-order`, also record for every attempt whether the plan states the release-before-switch order anywhere in its text (task body, plan or epic), and whether the agent read the memo's `webshop` to `argocd` line. In the cold run two of three failures named the order in the task text and still dropped the `depends-on` edge; that split decides what a fix would be.

## Cases the graders do not settle

As in the cold rubric:

- A task that tells someone to run `terraform plan` from a workstation fails `conventions`.
- `kubectl apply --dry-run` is not a hand apply.
- A check named only in plan.md or epic.md counts for a repo when it plainly applies to that repo's tasks; record "plan-level".
- One task that releases the webshop and bumps argocd's tag, followed by a separate traffic task that depends on it, passes `cross-repo-order`; note it.
- A grader verdict listing unattributed tasks is read by hand.

## Exclusions

Harness or API failures are excluded, and so is an attempt whose plan is not in the fixture because the agent skipped `--no-worktree`. A timeout counts as failed. Fewer than 8 graded attempts makes the experiment inconclusive; topping up is the user's call.

## Decision rule (from the design, fixed before the run)

For `cross-repo-order`, counted after the hand audit:

- At most one failing attempt: the memo the planner keeps covers the gap. The follow-up is making the memo's per-project conventions dependable, not profiles or part 4.
- Two or more failing: the memo does not cover it. Part 4 (relationship map) is designed, and that design is rerun on `multi-repo-context` (the cold scenario) with and without it. If most failures name the order in their text and drop the edge, the design note says so, since a relationship map adds knowledge and those plans already had it.

The other six checks passed in the cold run and need nothing; they are recorded here only to show the memo did not make them worse.

## Also recorded

Fresh tokens, cost, duration and pre-framing context per attempt, against the cold run's medians (492 s, $1.32, pre-framing context 46460 tokens), and the character count of `pm status` output on a freshly built fixture (`PM_TODAY` 2026-09-15).
