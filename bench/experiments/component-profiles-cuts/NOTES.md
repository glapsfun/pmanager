# component-profiles-cuts: hand audit and decision

Ten runs of `multi-stack-repo`, `with-skill` only, all `completed`, $11.84. The harness was claude-code 2.1.322 with claude-sonnet-5. `with-skill` is `feat/component-profiles` at `1cf467a` (skill `sha256:cc6507c8...`), the paired run's change plus the three cuts to its fix rounds. Grader version 3 was used at run time. `RUBRIC.md` was committed before the run (`a03b552`). The comparison is `../component-profiles-paired/`, which was not re-run.

Every plan was read by hand: two auditors, five plans each, against the paired `RUBRIC.md` and its rulings, without the grader's verdicts. The hand verdicts differ from grader version 3 in three rows, all failures the hand audit passes (see Grader version 3 below).

## Decision

Failing attempts, by hand:

| Check | cuts | paired with-skill | paired baseline-skill |
| :--- | :--- | :--- | :--- |
| own-checks-service | 0 | 0 | 6 |
| own-checks-terraform | 0 | 0 | 2 |
| own-checks-chart | 0 | 0 | 10 |
| no-borrowed-checks | 0 | 0 | 0 |
| resource-home | 0 | 0 | 0 |
| rollout-order | 0 | 0 | 10 |
| repos-registered | 0 | 0 | 0 |
| no-manager-commands | 0 | 0 | 0 |

| | cuts | paired with-skill | paired baseline-skill |
| :--- | ---: | ---: | ---: |
| Cost, median | $1.18 | $1.19 | $1.01 |
| Cost, mean | $1.18 | $1.24 | $1.09 |
| Duration, median | 504 s | 493 s | 439 s |
| Turns, median | 42 | 44.5 | 33 |
| First drafts E-REL fired on | 2 of 10 | 10 of 10 | n/a |

The decision rule, applied as written:

- **Quality: met.** own-checks-chart, own-checks-service and rollout-order fail in 0 of 10. The closest call (p5 T03, below) would make chart and rollout 1 of 10 each under a strict reading, still within the rule.
- **Cost: missed by $0.02.** The median is $1.18, against the $1.16 allowed (the paired baseline's $1.01 plus $0.15).
- **Outcome:** the rule's "otherwise" applies: report which cut did not take, and the call is the user's. All three cuts took (next section). The median barely moved because the cuts removed about $0.18 per run of fix-round input, while drafting and a detour the fixture invites grew by about $0.10 (Where the cost goes).

## What the cuts did

- **`plan:` line: took.** Every run's `pm research --repo orders` printed it. E-REL-001 and E-REL-002 fired on 2 first drafts (p1, p10), against 10 of 10 in the paired change arm. The other eight planned a release task (bump `VERSION`, `make release`) and a chart task that sets `image.tag` and depends on it, up front. p1 and p10 fixed E-REL with a real release task and a tag task; no run used `no-release:`.
- **A release task satisfies E-PRT-003 for the service: took.** In the paired run, five runs took an extra record round because the release task the E-REL fix had just added named no `make test`. Here, release tasks drew E-PRT-003 only for the chart, when they also changed the chart without naming its checks (p4 T07, p5 T07, p9 T10). Those are real gaps.
- **What a make target runs counts: took.** p2 T02 to T05 name only `go test ./...` and `go vet ./...` and drew no finding. In the paired run, that wording cost p1, p5 and p8 a round on 3 to 7 tasks.

E-PRT-003 still fired on 18 tasks in 7 runs. Twelve were real gaps:

- p1: seven tasks said only "Unit tests cover ..." and named no command.
- p4 T07, p5 T07 and p9 T10: release tasks that change the chart and name no chart check.
- p5 T02: a Terraform task that also edits `values.yaml`.
- p10 T08: a conditional Terraform fix.

Six were tasks that change no code but carry `parts:`: design or decision notes (p5 T01, p9 T01, p10 T01), a README-only task (p2 T09), a staging verification (p9 T08) and a chart task that also edits the root README (p8 T10). Their fixes were cheap: p9 set `parts: []`, which is accurate there, and the others added a `make test`/`make lint` line that verifies nothing. No fix emptied `parts:` on a task that changes code.

## Where the cost goes

Input-side estimate per run, mean, from `raw.jsonl` at the prices that reproduce each run's `costUsd` ($2 input, $4 cache write, $0.20 cache read per MTok). Output tokens are not per-message in the stream, so these are lower bounds; output totals are from telemetry. All three arms are measured the same way here, so the paired figures differ slightly from the fix-window range in `../component-profiles-paired/NOTES.md`. No fix window overlaps a manager-lint window.

| Phase | cuts | paired with-skill | paired baseline-skill |
| :--- | ---: | ---: | ---: |
| Up to the first `pm record` | $0.46 | $0.42 | $0.46 |
| First failing record to the next clean one | $0.10 | $0.28 | $0 |
| Manager repo's `bun run lint` / `bun test` and after | $0.10 | $0.07 | $0.17 |
| All input | $0.73 | $0.81 | $0.68 |
| Output tokens, mean | 42.7k | 40.5k | 38.8k |
| Tool calls, mean | 41.8 | 43.5 | 33.1 |

- **Fix rounds** fell by about $0.18 per run, as aimed. What remains is mostly p1 ($0.30, seven real gaps) and p9 ($0.22).
- **The manager detour is the fixture's.** `bench/scenarios/multi-repo-context-memo.md:27` seeds the memo with "`bun run lint` and `bun test` before committing here" for the manager repo. p2 and p7 followed it after a clean record and chased markdownlint findings, $0.47 and $0.54 input-side, the two largest phases in this run. p2 also ran `git checkout main -- .` and added a `/tmp/lint-check-main` worktree. In the paired run, two change-arm and four baseline runs did the same. It is not the change, but it adds about $0.5 to any run that takes it, so with ten runs it moves the median.
- **Drafting** is the same as main's ($0.46 both). The plan line adds the release and tag tasks to the first draft rather than to a fix round.
- **Without the detour**, the change still costs more than main: input $0.63 against $0.51 per run, mean. The difference is the remaining fix rounds ($0.10) and longer drafts.

## Per attempt

| Pair | Cost, duration, turns | First record | Records to clean | Fix window, input-side | E-PRT-003 (real / noise) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| p1 | $1.30, 481 s, 64 | E-REL-001/002, E-PRT-003 x7 | 2 | 25 calls, $0.30 | 7 / 0 |
| p2 | $1.37, 525 s, 53 | E-PRT-003, E-REF-005 | 2 | 8 calls, $0.11 | 0 / 1 |
| p3 | $1.03, 500 s, 34 | clean | 1 | none | 0 / 0 |
| p4 | $1.39, 546 s, 48 | E-PRT-003, structure errors from a placeholder bundle | 2 | 2 calls, $0.10 | 1 / 0 |
| p5 | $0.91, 340 s, 36 | E-PRT-003 x3 | 2 | 7 calls, $0.15 | 2 / 1 |
| p6 | $0.94, 425 s, 28 | clean | 1 | none | 0 / 0 |
| p7 | $1.56, 583 s, 54 | clean | 1 (a second record fixed markdown spacing) | none | 0 / 0 |
| p8 | $0.97, 396 s, 35 | E-PRT-003 | 2 | 3 calls, $0.06 | 0 / 1 |
| p9 | $1.27, 508 s, 56 | E-PRT-003 x4 (three tasks) | 2 | 7 calls, $0.22 | 1 / 2 |
| p10 | $1.10, 511 s, 30 | E-REL-001/002, E-PRT-003 x2 | 2 | 1 call, $0.06 | 1 / 1 |

Every attempt passes all eight checks by hand. In every run the chart's checks came from the research block: only p1 opened `.github/workflows/chart.yml`.

## Rulings

- **p5 T03 (closest call): pass on own-checks-chart, no-borrowed-checks and rollout-order.** T03 adds the export-request handler and wires `storage.exportBucket` into `deploy/chart/templates/deployment.yaml` under `parts: [orders]`, naming only `make test` and `make lint`. It changes the service, so no-borrowed-checks does not apply. The plan's Definition of done names `helm unittest deploy/chart` / `ct lint --charts deploy/chart` for chart changes, so own-checks-chart passes at plan level. T02 creates the bucket and sets `storage.exportBucket` in `values.yaml` in one task, so T02 makes the bucket link; T03 reads the value and depends on T01 only. Under the grader's reading (T03 sets the bucket value before the bucket), chart and rollout fail 1 of 10 each, still within the rule.
- **p7 T05: pass on no-borrowed-checks.** It verifies the Terraform lifecycle rule and changes `GET /orders/export/{id}`, and names both parts' checks.
- **One task that releases and sets the tag** (p4 T07, p5 T07, p9 T10): the image link passes, as the paired rubric says.
- **p8 T12** names `make release` only to say where the tag comes from: a chart-only task.

## Grader version 3

Version 3 fails three rows that pass by hand:

- **p7 no-borrowed-checks.** T05's service change names an endpoint (`GET /orders/export/{id}`), not a Go path, so the grader places T05 in Terraform only and reads its `make test` as borrowed. This is the class version 3 fixed for README, end-to-end and `VERSION` wording, in a new form.
- **p5 no-borrowed-checks and rollout-order.** T03 names `deploy/chart/templates/deployment.yaml` and "a new handler in the `orders` package", so the grader places it in the chart only, and reads its wiring of `storage.exportBucket` as setting the bucket value.

Not fixed here. The hand verdict stands, and none of the three changes the decision.

## Other findings

- **The fixture tells runs to lint the manager repo.** `bench/scenarios/multi-repo-context-memo.md:27` (see above). Across the three arms it ran in 8 of 30 runs, at $0.23 to $0.85 input-side each.
- **`parts:` is trusted as written, again.** p5 T03 edits the chart under `parts: [orders]`, so E-PRT-003 never asked it for chart checks. p1 T09 claims all three parts and changes nothing.
- **E-REL does not check for a `VERSION` bump.** p5's release runs `make release` but no task bumps `VERSION`, so as written it re-pushes `1.4.0`.
- **Release tasks do not always wait for the code.** p6's release does not depend on T09 (metrics) and p7's not on T05 or T06. No check covers this.
- **Forbidden commands slip through.** p2 T01 and its M4 ask for confirmation "by `terraform plan`", which the profile lists as forbidden. No rule checks it.
- **One resource change per pull request.** p7 T01 and p10 T02 put the bucket and its lifecycle rule in one task, against `infra/terraform/AGENTS.md`. Neither run opened that file, and the profile does not carry the rule.
- **Writes outside the fixture.** p10 wrote two files into the harness's auto-memory directory. p5 and p8 left bundles under `/tmp`. p2 added a `/tmp/lint-check-main` worktree. p3, p8 and p9 ran `pm release` at the end.
