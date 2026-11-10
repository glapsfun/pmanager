# multi-stack-repo-cold-2: hand audit and decision

Ten runs of `multi-stack-repo` (the example workspace plus `orders`, a monorepo with a Go service at the root, Terraform in `infra/terraform/` and a Helm chart in `deploy/chart/`), all `completed`, $11.37, claude-code and claude-sonnet-5 on main's skill (`sha256:2e5a036d...`), grader version 1 at run time. `RUBRIC.md` was committed before the run. The `orders` tree is `f89e6542d52d3e065cd3251311944f86c9c8c506`, as pinned. Every plan was read by hand (two auditors, five plans each, against `RUBRIC.md` and without the grader's verdicts, then checked against each other and the grader). The hand verdicts differ from grader version 1 in four rows, all grader bugs; grader version 2 fixes them, and re-grading the ten saved plans with it gives exactly the hand verdicts.

## Decision

| Check | Failing attempts |
| :--- | :--- |
| own-checks-service | 5 (p3, p5, p6, p7, p9) |
| own-checks-terraform | 2 (p3, p6) |
| own-checks-chart | 10 (all; p2, p4, p5, p10 partial) |
| no-borrowed-checks | 0 |
| resource-home | 0 |
| rollout-order | 9 (all but p2), all 9 counting toward the map |
| repos-registered | 0 |
| no-manager-commands | 0 |

The decision rule, applied as written:

- **Profiles** carry each part's commands: the chart's CI checks (10 of 10), the service's commands (5) and the Terraform part's check (2) all fail in 2 or more attempts. No attempt borrowed the service's `make test` for another part, and every bucket went to orders' own Terraform.
- **The map** is built for links between parts: in all nine `rollout-order` failures the plan never names the image link (the chart's image tag follows the service's release) at file level, and p6 does not name the bucket link either.

Under the lenient reading of `own-checks-chart` (counting "the chart's test file passes" as naming the check), it fails 6 times, so the decision is the same either way.

## What the failures are

- **Chart checks: nobody found them.** No attempt opened `.github/workflows/chart.yml`, the only file that names `helm unittest` and `ct lint`. Several ran `find ... -not -path '*/.git*'`, which also hides `.github/`. `pm research --repo orders` returned `chart.yml` only for its `helm upgrade` line (p1, p2, p8, p9), never for the test commands. Four plans named the chart's test file or "a helm test" instead (partial).
- **Terraform check: found when read.** Every attempt that opened `infra/terraform/AGENTS.md` named `./scripts/tf-check.sh`; the two failures (p3, p6) never opened it, and both fell back to `terraform plan`, which that file forbids from a workstation.
- **Service commands: read but not used.** All five failures opened the root README, which names `make test` and `make lint`, and wrote "tests pass" or "unit tests cover ..." with no command. A profile only closes this if the commands reach the tasks, not just the planner's context.
- **The image link: nobody planned it.** Only p2 rolled out the new image (T10 bumps the image version through the Makefile's `release` target, after the bucket). p10 releases (`make release`) but no task moves `image.tag`; the other eight have no release task and no tag change at all, so the new code would never reach the cluster. The bucket link, which `values.yaml` and `outputs.tf` show by matching literals, was made in eight of the nine failures (five within one task that creates the bucket and wires it).

## Per attempt

| Attempt | Fails (by hand) | Files opened (of the part files) |
| :--- | :--- | :--- |
| p1 | chart, rollout (image) | README, Makefile, service.yml, AGENTS.md |
| p2 | chart (partial) | README, Makefile, AGENTS.md |
| p3 | service, terraform, chart, rollout (image) | README, Makefile |
| p4 | chart (partial), rollout (image) | README, Makefile, AGENTS.md |
| p5 | service, chart (partial), rollout (image) | README, AGENTS.md, tf-check.sh, deployment_test.yaml |
| p6 | service, terraform, chart, rollout (no chart task; image and bucket) | README, values.yaml, main.tf |
| p7 | service, chart, rollout (image) | README, AGENTS.md, values.yaml, outputs.tf |
| p8 | chart, rollout (image) | README, AGENTS.md, values.yaml |
| p9 | service, chart, rollout (image) | README, AGENTS.md, Makefile, outputs.tf, values.yaml |
| p10 | chart (partial), rollout (image) | README, AGENTS.md, Makefile, values.yaml, deployment_test.yaml |

## Grader version 2

Version 1 disagreed with the hand audit in four rows:

- p1 own-checks-service and no-borrowed-checks: T10, an end-to-end test task, cites `deploy/chart/tests/deployment_test.yaml` as a pattern, so version 1 placed it in the chart (a chart-only task naming `make test`) and not in the service.
- p8 own-checks-service: T06, an end-to-end test task, names only endpoints and "`make test` or the project's existing test command", so version 1 placed it nowhere. p1 T10 and p8 T06 say the same and both pass by hand (the two auditors had split on them; one ruling settles both).
- p2 rollout-order: version 1 read neither "the existing release process (`Makefile`'s `release` target)" as a release nor "bump the chart/image version" as the image tag.

Version 2: a mention of the chart's `tests/` path alone no longer places a task in the chart; a task no rule places that names `make test` is a service task; "release process", "release target" and "image version" are read. Each has a test from the plan's own wording, which failed first.

## Cost

| Attempt | Cost | Duration | Turns |
| :--- | ---: | ---: | ---: |
| p1 | $1.36 | 515s | 46 |
| p2 | $1.03 | 466s | 26 |
| p3 | $1.17 | 426s | 44 |
| p4 | $1.04 | 465s | 41 |
| p5 | $0.76 | 304s | 30 |
| p6 | $1.27 | 533s | 45 |
| p7 | $0.99 | 429s | 35 |
| p8 | $0.90 | 389s | 23 |
| p9 | $1.16 | 423s | 50 |
| p10 | $1.68 | 602s | 52 |

Medians (REPORT.md): cost $1.10, duration 447 s.

## Outside the eight checks

- p3 ran the manager's `bun run lint && bun test`, `git stash` and `git stash pop`, and created and force-removed a worktree under `/tmp`; none of it is in the plan. p10 also ran the manager's checks.
- p4 and p5 ran `pm release` at the end; the drafts stay on their branches.
- p5 ran `find / -maxdepth 3 -iname "orders*"` outside the fixture (read-only).
- p9 recorded once with a placeholder plan.md, failed `E-STR-002`, rewrote it and recorded again.

## Notes for the next design

- The chart result points at discovery as much as at storage: a profile that carries each part's CI checks fixes it, and so would `pm research` surfacing commands from CI workflow files, or planners not hiding `.github/`.
- The service result is a writing gap, not a knowledge gap: the commands were in context. A profile alone may not move it; the planning step that writes acceptance criteria has to put them in.
- The map's case is the image link: release, then move the chart's tag. The bucket link was mostly found from the matching literals.
- These links are between parts of one repo; how component-level links fit #16's project-to-project relationships is for the design.
