# component-profiles-paired: hand audit and decision

Twenty runs of `multi-stack-repo`, ten pairs, all `completed`, $23.33. The harness was claude-code 2.1.321 with claude-sonnet-5. `with-skill` is `feat/component-profiles` at `b6b4ece` (skill `sha256:4ce019e1...`), with profiles refreshed and committed by `prepareCondition`. `baseline-skill` is main at `4ad8596`. Grader version 2 was used at run time. `RUBRIC.md` was committed before the run (`0825097`). The `orders` tree is pinned by `bench/tests/scenario-multi-stack-repo.test.ts`, which passes on this commit.

Every plan was read by hand: four auditors, five plans each, against `RUBRIC.md` and without the grader's verdicts. The hand verdicts were then checked against the grader, and every disagreement and every unsure case was re-read. The hand verdicts differ from grader version 2 in six rows, all grader bugs, all in the change arm. Grader version 3 fixes them; re-grading the 20 saved plans with it gives the hand verdicts. The exceptions are three plan-level rows, which the rubric leaves to the hand audit.

## Decision

Failing attempts, by hand:

| Check | with-skill | baseline-skill |
| :--- | :--- | :--- |
| own-checks-service | 0 | 6 (p1, p3, p4, p5, p6, p9) |
| own-checks-terraform | 0 | 2 (p4, p8) |
| own-checks-chart | 0 | 10 |
| no-borrowed-checks | 0 | 0 |
| resource-home | 0 | 0 |
| rollout-order | 0 | 10 (image link in all ten; p7 also the bucket link) |
| repos-registered | 0 | 0 |
| no-manager-commands | 0 | 0 |

The decision rule, applied as written:

- **Quality: met.** own-checks-chart, own-checks-service and rollout-order fail in 0 of 10 change-arm attempts, against 10, 6 and 10 in the baseline arm. All three reproduced.
- **Cost: missed by $0.03.** The change arm's median cost is $1.19, against $1.01 in the baseline arm: +$0.18 against the +$0.15 allowed. The paired cost difference is +$0.18 at the median (IQR -$0.02 to +$0.37), and the change arm was cheaper in two pairs (p4, p8). It also took a median of 70 s and 7 steps more.
- **Outcome:** the rule's "otherwise" applies. The change arm did not fail on quality. It failed only on cost, so the call is the user's.

## What the change did

- **Chart checks: from the research block.** No run in either arm opened `.github/workflows/chart.yml`. In all ten change-arm runs, `pm research --repo orders` printed the `parts:` block, and the plan copied `helm unittest deploy/chart` and `ct lint --charts deploy/chart` from it word for word.
- **Service and Terraform checks: from the block too.** Change-arm tasks copied their part's commands from the block, and E-PRT-003 caught the tasks that did not. The baseline arm opened the root README, which names `make test` and `make lint`, in all ten runs, and still named no service command in six.
- **The image link comes from the rule, not the block.** E-REL-001 ("change orders, and no task releases it") and E-REL-002 ("no task naming orders/deploy/chart moves image.tag after orders's release") fired on the first `pm record` in 10 of 10 runs. The parts block listed the release link, but no first draft planned the release. Every fix added a real release task (bump `VERSION`, `make release`) and a tag task that depends on it. No fix used `no-release:`.
- **E-PRT-001 and E-PRT-002 never fired.** E-PRT-003 ("changes <part> but names none of its checks") fired in 9 of 10 runs.

## Where the extra cost goes

Each run's fix window, from the first failing `pm record` to the next clean one, cost about $0.16 to $0.33. That is input-side only, so it is a lower bound. It covers most of the +$0.18. Three kinds of fix round:

| Kind | Runs | Extra |
| :--- | :--- | :--- |
| E-REL-001/002: no release task, tag not after the release | all ten | one record round, 4 to 8 calls |
| E-PRT-003 on the release task the E-REL fix had just added | p2, p3, p4, p7, p10 | one more record round |
| E-PRT-003 rejecting `go test ./...` and `go vet ./...` where the profile lists `make test` and `make lint` (`README.md:7`) | p1 (7 tasks), p5 (3), p8 (5) | 10 to 19 calls |

Outside the feature: four baseline runs (p2, p4, p7, p8) and two change-arm runs (p1, p9) ran the manager's `bun run lint` and `bun test`. That cost about $0.34 in p1 and $0.35 in p9. p5 (change arm) recorded twice with placeholder bundles that overwrote its epic and plan, about $0.29.

## Per attempt

| Pair | with-skill: cost, duration, turns | rule findings on the first failing record | baseline: cost, duration, turns | baseline fails (by hand) | baseline part files opened |
| :--- | :--- | :--- | :--- | :--- | :--- |
| p1 | $1.45, 514 s, 59 | E-REL-001/002, E-PRT-003 x7 | $1.02, 434 s, 39 | service, chart, rollout (image) | README, AGENTS.md |
| p2 | $1.20, 440 s, 46 | E-REL-001/002, E-PRT-003 x1; then x1 on the release task | $1.24, 524 s, 39 | chart, rollout (image) | README, AGENTS.md |
| p3 | $1.18, 489 s, 42 | E-REL-001/002; then E-PRT-003 on the release task | $0.98, 388 s, 31 | service, chart, rollout (image) | README, AGENTS.md |
| p4 | $0.98, 387 s, 25 | E-REL-001/002; then E-PRT-003 on the release task | $1.19, 469 s, 38 | service, terraform, chart, rollout (image) | README |
| p5 | $1.75, 565 s, 62 | E-REL-001/002, E-PRT-003 x3 | $0.82, 390 s, 24 | service, chart, rollout (image) | README, AGENTS.md |
| p6 | $1.20, 504 s, 43 | E-REL-001/002 | $1.01, 445 s, 29 | service, chart, rollout (image) | README, AGENTS.md |
| p7 | $1.17, 499 s, 47 | E-REL-001/002; then E-PRT-003 on the release task | $1.13, 494 s, 35 | chart (no chart task), rollout (bucket, image) | README, AGENTS.md |
| p8 | $1.13, 428 s, 55 | E-REL-001/002, E-PRT-003 x5 | $1.81, 601 s, 55 | terraform, chart, rollout (image) | README, Makefile |
| p9 | $1.39, 498 s, 42 | E-REL-001/002, E-PRT-003 x1 (README task) | $0.88, 412 s, 30 | service, chart, rollout (image) | README, AGENTS.md |
| p10 | $0.99, 421 s, 34 | E-REL-001/002; then E-PRT-003 on the release task | $0.82, 336 s, 31 | chart, rollout (image) | README, AGENTS.md |

Every change-arm attempt passes all eight checks by hand. No baseline attempt opened `service.yml`, `chart.yml` or `tf-check.sh`, and none names `image.tag` or a release.

## Rulings

- **Baseline p3 own-checks-service: fail.** `make test` and `make lint` appear only as a row in the epic's Evidence table, as a fact found. No task or milestone asks for them.
- **Baseline p8 and p10 own-checks-service: pass, plan-level.** In p8, the Validation plan says each milestone's exit criteria are shown by `go test ./...`. In p10, M2's exit criteria say "`make test` passes for all new and existing orders-service tests". Grader version 3 still fails these two, because it reads tasks only. The rubric leaves plan-level checks to the hand audit.
- **Baseline p7 no-borrowed-checks: pass.** The plan's Definition of done names `make test` and `make lint` for every task. That makes them a repo-wide gate, not a service command used in place of the Terraform tasks' own checks.
- **Change arm p2 T01 `parts: []`: not a dodge.** After E-PRT-003, the planner emptied the `parts:` of a task that writes only a markdown note in `orders`. The service check passes on T02 anyway, so no verdict depends on it.

## Grader version 3

Version 2 failed `no-borrowed-checks` in six change-arm attempts that pass by hand. Each flagged task does service work that names no Go path, so version 2 placed it in Terraform or the chart only:

- **p1 T09, p2 T08 and p4 T06:** end-to-end tests and the root `README.md`. p1 and p4 also run the chart's checks; p2 calls one test "terraform-level".
- **p5 T05:** service logging, cleanup and the root `README.md`, next to a Terraform verification.
- **p6 T09:** the release task. It bumps `VERSION` in `Makefile` and runs `make release`, and names `deploy/chart` and `image.tag` only to leave them to the chart task.
- **p8 T08:** an end-to-end verification that runs `make test` next to `tf-check.sh`.

Version 3 places a task in the service, and counts it as changing the service, when it names any of these:

- the root `README.md` (a folder's own README stays that folder's)
- an end-to-end, e2e or integration test
- a `VERSION` bump

Each case has a test written from the plan's own wording, and each test failed first. A chart task that names `make release` only to say where the tag comes from still borrows (the version 2 test is unchanged). Re-grading the 20 saved plans with version 3:

- The change arm fails no check.
- The baseline arm keeps its version 2 verdicts. Those equal the hand verdicts except the two plan-level passes above.

## Other findings

- **`parts:` is trusted as written.** The rules read only `parts:`, so a wrong value silences them:
  - p9 T01 edits `values.yaml`, but its `parts:` lists only Terraform.
  - p5 T01 omits the chart, which it changes.
  - p1 T09 claims the chart, which it does not change, so the fix added chart checks to it.
  - p3 T01 and T07 use `parts: []`, but they write a note and the service README.
- **A forbidden command slips through.** p10 (change arm) T01 asks the implementer to run `terraform plan`, which `infra/terraform/AGENTS.md` forbids from a workstation. The profile lists it under forbidden, but no rule checks for it.
- **One-phrase research comes back empty.** Three baseline runs (p1, p4, p5) passed `pm research` their keywords as one quoted phrase and got empty output every time. p2 and p3 passed separate words and got hits.
- **Writes outside the fixture.** p7 (change arm) wrote two files into the harness's auto-memory directory. Several runs wrote bundles under `/tmp`. Baseline p8 left a `/tmp/main-lint-check` worktree registered. p5 (change arm) and baseline p10 ran `pm release` at the end.
