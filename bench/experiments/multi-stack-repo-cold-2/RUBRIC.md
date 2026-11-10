# multi-stack-repo-cold-2: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-10-multi-stack-repo-bench-design.md`. Replaces the retired, unrun `multi-stack-repo-cold`, whose request allowed exports under a prefix of the existing bucket.

## Question

Without project profiles or a relationship map, how often does a plan for a change to a multi-stack repo (a Go service, its Terraform and its Helm chart in one repo, each part's commands written only in that part's own file) get a part's commands wrong, put the work in the wrong repo, or miss the order between parts that no single file states?

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

## Decision rule (copied from the design, fixed before the run)

Counted by hand, over 10 attempts.

- **Profiles:** each of own-checks-service, own-checks-terraform, own-checks-chart, no-borrowed-checks and resource-home that fails in 2 or more attempts is a fact profiles must carry. If none does, profiles are not built.
- **Map:** a `rollout-order` failure counts toward the map when, for at least one missing edge, the plan never names that link at file level. If 2 or more attempts count, the map is built for links between parts. If the failures name their links and only the edges are missing, the map is not built; the gap is a dependency rule's.
- Every other check, the cost and the duration are reported with no threshold.
