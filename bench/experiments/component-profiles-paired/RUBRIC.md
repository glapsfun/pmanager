# component-profiles-paired: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-10-component-profiles-design.md`; scenario and checks as in `multi-stack-repo-cold-2` (grader version 2). Conditions: `with-skill` is this branch (profiles stored at registration, the research parts block, `parts:` and the handoff section, rules E-PRT-001..003 and E-REL-001..002); `baseline-skill` is main at `4ad8596`. The shared fixture holds no profile in any commit, branch or worktree; `prepareCondition` refreshes and commits profiles for `with-skill` only.

## Question

With component profiles, the research parts block and the new rules, do plans for a change to a multi-stack repo name each part's own checks and move the chart's image tag after the service's release, against the same request on main's skill, at no noticeable cost per run?

## Per attempt

For each graded attempt, read `artifacts/<attempt>/docs-pm/` (epic, plan, tasks) and the transcript (`raw.jsonl`), and record one row per check:

| Check | Verdict | Source |
| :--- | :--- | :--- |
| own-checks-service | pass / fail | where the fact came from |
| own-checks-terraform | pass / fail / n/a | |
| own-checks-chart | pass / fail | |
| no-borrowed-checks | pass / fail | |
| resource-home | pass / fail / n/a | |
| rollout-order | pass / fail | per link, below |
| repos-registered | pass / fail | |
| no-manager-commands | pass / fail | |

Also record **parts researched**: which `pm research --repo` calls covered `orders`, and which of the part files below the transcript opened.

**Verdict.** From reading the plan, not from the grader alone. Where the two differ, the hand verdict stands and `NOTES.md` records the grader bug and the re-grade (grader version 2).

**n/a.** Every design changes all three parts: service code, a Terraform change for the exports storage, and the chart's image tag. A part the design needed but no task changes is a fail, never n/a. n/a exists only for: `own-checks-terraform` when the bucket went to the workspace's `infra` repo (`resource-home` fails instead); and the bucket link and `resource-home` when the plan keeps exports in the existing orders bucket against the request's "their own storage". Each n/a is recorded with its reason. The decision rule counts failures only.

**Source.** From the transcript: the agent opened the file that holds the fact, or ran `pm research --repo` on `orders` and the fact appears in its output.

| Part | Files that hold its commands |
| :--- | :--- |
| service | root `README.md`, `Makefile`, `.github/workflows/service.yml` |
| Terraform | `infra/terraform/AGENTS.md`, `infra/terraform/scripts/tf-check.sh` |
| chart | `.github/workflows/chart.yml` |

A pass with no traceable source is "passed, source unclear". A command that only a part's own file names (`tf-check`, `checkov`, `helm unittest`, `ct lint`) cannot be guessed; if one appears with no traceable source, read the transcript again before calling the fixture leaky.

## Rollout order, per link

For each `rollout-order` failure, record each missing edge and whether the plan names that link at file level anywhere in its text (plan, task Context, What to do, Notes or criteria):

- **Bucket link:** the plan says the chart's bucket value comes from the Terraform output (for example "set `exports.bucket` from the `exports_bucket_name` output").
- **Image link:** the plan says the chart's image tag is set to the version the release pushed (for example "set `image.tag` to the version `make release` pushed").

A prose order ("after the bucket exists", "once the release is out") does not count.

## Cases the graders do not settle

- A check named only in `plan.md` or `epic.md` (for example a Definition of done) counts for a part when it plainly applies to that part's tasks; record "plan-level" as its source.
- A bucket created in the workspace's `infra` repo fails `resource-home`; `own-checks-terraform` is then n/a unless a task also works in `orders/infra/terraform/`.
- One task that changes both the service's code and the chart is not checked by `no-borrowed-checks` (the grader lists it); read it by hand and note it. A chart task that names `make release` or the image only to say where the tag comes from is a chart-only task.
- One task that releases the service and sets the chart's image tag passes the image link (the release comes first inside it); note it. Likewise one task that creates the bucket and sets the chart's bucket value passes the bucket link.
- Chart changes split across tasks are judged per link, on the task that makes each link; the image task need not wait for the bucket task.
- A task outside the chart that describes the chart's setting in passing (a writer that says "the chart sets EXPORTS_BUCKET from values.yaml") is read by hand: judge each link on the task that actually changes the chart.
- A grader verdict that lists unattributed tasks in its evidence is read by hand: place each task and re-grade.

## Record per run

The `orders` tree of the fixture, since the manifest's fixture hash covers only the manager: `f89e6542d52d3e065cd3251311944f86c9c8c506` (`git -C <fixture>-pm-workspace/orders rev-parse HEAD^{tree}`), pinned by `bench/tests/scenario-multi-stack-repo.test.ts`. A build in UTC gives commit `c47baffa348ff3ac94df5a640966923a36b28961`.

## Exclusions

Harness or API failures (crash, API error) are excluded, and so is an attempt whose plan is not in the fixture because the agent skipped `--no-worktree` (its plan cannot be read). A timeout counts as failed. Fewer than 8 graded attempts makes the experiment inconclusive; topping up is the user's call.

## Per change-arm attempt

Also record, from the transcript:

- whether a `pm research --repo orders` call printed the `parts:` block, and whether the plan's task criteria copy commands from it;
- each E-PRT-* and E-REL-* finding that `pm record` reported, and how the planner fixed it (named a check, added a release task, moved the tag, added a `depends-on`, used `parts: []` or `no-release:`), with the extra tool calls and cost of that fix;
- whether a task names the bare `orders` id or a folder part, and whether its `parts:` matches what the task changes.

A fix that satisfies a rule without doing the work (`parts: []` on a task that changes the chart, `no-release:` on an epic that ships the export) is recorded as such and counts as the check failing.

Note: the terraform part's profile lists `terraform validate` and `tflint` as checks (its `AGENTS.md` names them as what `./scripts/tf-check.sh` runs), so E-PRT-003 can pass while `own-checks-terraform`, which wants the wrapper or `checkov`, fails. Read that check with this in mind; it has no threshold.

## Decision rule (copied from the design, fixed before the run)

Counted by hand on own-checks-chart, own-checks-service and rollout-order:

- Ships when each of the three fails in at most 1 of 10 change-arm attempts and the change arm's median cost per run is within +$0.15 of the baseline arm's.
- A check where the baseline arm fails at most once did not reproduce; it is reported and does not block or support shipping.
- Otherwise: read how the change arm failed (rule fired and was fixed wrongly, rule never fired, research block not read) and decide with the user.

Own-checks-terraform, the other checks, duration and turns are reported with no threshold.
