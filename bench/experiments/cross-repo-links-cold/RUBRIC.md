# cross-repo-links-cold: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-19-cross-repo-links-bench-design.md` (#77 milestone 1). Grader: `bench/graders/cross-repo-links.ts`, version 1.

## Question

Given a request that touches only the provider of a cross-repo link that no doc names, with today's main, profiles on and no network, how often does the plan:

- miss the consumer;
- order the change unsafely?

## The links

Both links are in the overlay under `bench/scenarios/fixtures/cross-repo-links/`. No README, AGENTS.md, memo, epic or commit message names either one. `infra/AGENTS.md:14` names `cluster_name` and `ingress_lb_name` only, not the new output; it is a partial hint for the bucket run.

| Scenario | Provider | Consumer (file and line) | Correct plan |
| :--- | :--- | :--- | :--- |
| cross-repo-endpoint | orders `internal/orders/store.go:12`, `json:"total_cents"`, served by `List` at `:23` for `GET /orders` | webshop `history.go:13` decodes `total_cents`, called from `history.go:17` (`ORDERS_URL` + `/orders?customer=`), route in `main.go:15`; test in `history_test.go:16`. The address is argocd `workloads/webshop/deployment.yaml:21-22` (`ORDERS_URL: http://orders.orders.svc.cluster.local:8080`) | Webshop reads the new `total` object (or both shapes), tags a release and rolls it out (argocd `newTag`). Orders removes `total_cents` only after that rollout, or serves both shapes and defers the removal |
| cross-repo-output | infra `envs/prod/assets.tf:2`, `bucket = "pm-example-webshop-assets"`, output `webshop_assets_bucket` at `:5` | argocd `workloads/webshop/deployment.yaml:23-24`, `ASSETS_BUCKET: pm-example-webshop-assets`; read in webshop `history.go:36` | Create `pm-example-webshop-media` (versioning on, noncurrent versions expire after 90 days); set `ASSETS_BUCKET` to it in argocd and roll it out; delete the old bucket last, after the switch |

The orders chart gets a Service (`orders/deploy/chart/templates/service.yaml`) so `orders.orders.svc.cluster.local` resolves to something the chart deploys. Each run carries the other link as background; the checks grade only the link the request touches.

## Check definitions

Copied from the design's "Checks" section. The hand audit is the authority: where the grader differs, the hand verdict stands.

**cross-repo-endpoint**

- `client-covered`: a live task changes webshop's decoding of `total_cents` (its `parts:` names a webshop part, or its text names webshop and the field or the new shape).
- `client-safe-rollout`: no live task removes `total_cents` from orders' response unless it depends, directly or transitively, on the task that rolls webshop's change out (argocd `newTag`), or on the webshop change task when that same task also releases and rolls out. A plan that serves both shapes and defers removal passes. A plan that removes `total_cents` with no webshop task fails.

**cross-repo-output**

- `consumer-covered`: a live task changes `ASSETS_BUCKET` in argocd's webshop deployment: its `parts:` names that argocd part, or its text names `ASSETS_BUCKET` or `workloads/webshop/deployment.yaml`.
- `switch-order`: that task depends, directly or transitively, on the task creating the new bucket, and the task deleting the old bucket depends on it. A plan that deletes the old bucket with no such task fails.

**Hand verdicts.** For the four scenario checks the hand verdict is pass, fail or n/a, following the spec over the grader.
- A plan that names the consumer but has no task for it fails its order check (the "named but no task" class, which counts toward rule 2).
- A plan that never names the consumer and has no removal task (endpoint) or no delete task (output) gets n/a on its order check and does not count toward rule 2.
- The grader's `switch-order` skip (no switch task and no delete task) is resolved by these two rules.
- `client-safe-rollout` has no skip.

## Per attempt

For each graded attempt, read `artifacts/<attempt>/docs-pm/` (epic, plan, tasks) and the transcript (`raw.jsonl`). Record one row per check:

| Check | Verdict | Source | Class |
| :--- | :--- | :--- | :--- |
| client-covered (endpoint) | pass / fail | | |
| client-safe-rollout (endpoint) | pass / fail | | |
| consumer-covered (output) | pass / fail | | |
| switch-order (output) | pass / fail / n/a | | |
| scoped-diff | pass / fail | | |
| committed | pass / fail | | |
| check-no-errors | pass / fail | | |
| index-present | pass / fail | | |
| memo-present | pass / fail | | |
| log-entry | pass / fail | | |
| epic-and-plan | pass / fail | | |
| tasks-min-3 | pass / fail | | |
| binary-acceptance | pass / fail | | |
| draft-awaits-approval | pass / fail | | |

The verdict comes from reading the plan, not from the grader alone. Where the two differ, the hand verdict stands, and `NOTES.md` records the grader bug and the re-grade (grader version 2).

**Source.** From the transcript: the agent opened the file that holds the fact, or `pm research` output showed it. The files are:
- `history.go` or `main.go` in webshop;
- `workloads/webshop/deployment.yaml` in argocd;
- `envs/prod/assets.tf` in infra;
- `internal/orders/store.go` in orders.

A pass with no traceable source is "passed, source unclear".

## Classes for each failed consumer check

Every failed `client-covered` or `consumer-covered` gets exactly one class. Definitions are copied from the design.

- **Names the consumer** means a plan document (epic, `plan.md`, a task, including notes and assumptions) states the link itself: webshop calls or decodes `GET /orders` or reads `total_cents`; or the bucket name is set in argocd's webshop deployment or `ASSETS_BUCKET`. A passing mention does not count ("webshop unaffected", "verify any clients"), nor does "webshop uses the bucket" without where the name is set.
- **A generic search task** ("find and update every reference to `pm-example-webshop-assets`") fails the consumer check and does not name the consumer: the plan did not know the consumer when it was written, which is what the atlas would add. The rubric tallies these as their own class, and NOTES says if the decision hinges on them.
- **Named but no task:** a plan that names the consumer but has no task for it passes nothing extra: it fails the consumer check, does not count toward rule 1, and its order check fails, so it counts toward rule 2. The rubric tallies these as their own class too.

So each failed consumer check is one of: never names the consumer (counts toward rule 1), passing mention (never names it, counts toward rule 1), generic search task (never names it, counts toward rule 1, tallied apart), or named but no task (counts toward rule 2).

| Attempt | Scenario | Class | Evidence |
| :--- | :--- | :--- | :--- |
| | | never names / passing mention / generic search task / named but no task | quote and file |

## Route

For each attempt, record whether the transcript opened the consumer file, and how it got there:
- `pm research`;
- a grep (name the pattern);
- `infra/AGENTS.md` (did the planner read line 14, and did it follow it);
- other.

| Attempt | Scenario | Opened consumer file | How | Read `infra/AGENTS.md:14` |
| :--- | :--- | :--- | :--- | :--- |
| | | yes / no | research / grep / AGENTS.md / other | yes / no |

## Pinned state

The manifest's fixture hash covers only the manager repo, so the targets' trees are pinned by `bench/tests/scenario-cross-repo-links.test.ts` (`git -C <fixture>-pm-workspace/<repo> rev-parse HEAD^{tree}`):

| Repo | Tree |
| :--- | :--- |
| webshop | `402d095a252aa32582c84e05f6c385732c628548` |
| infra | `7f5dce1a19c5e19dbc2f0eb50979bf08ababd69c` |
| argocd | `96e4411de7aa82732570eaf3444195ba1b7de2ce` |
| orders | `1f2d57094944e2ae949a2c9ff5512aaca523b407` |

Manifest: `cross-repo-links-cold`, claude-code 2.1.327, `claude-sonnet-5`, condition `with-skill`, 10 pairs, `--timeout-s 1500`, offline. Both scenarios at version 1, grader version 1, fixture hash `sha256:4586c28d5d2b443e769fba3b260fa153af12c2c9c70a31d01efc15b77fcf684b`. 20 planned attempts.

Cost estimate: `experiment new` prints none. The estimate from `estimateCost` over the harness history is $15.51 for 20 attempts. The design's expectation, from the last cold runs, is about $25 to $30.

## Record per attempt, not gated

- **Opened files:** which of the four files above the transcript opened.
- **Other link:** whether the plan touched the link the request did not name, and how.
- **Runs that got online:** what was fetched, and whether it changed the plan. Such a run is graded normally and flagged.
- **Cost:** cost, the phase breakdown used in the #16 runs, and wall time. #61 (the fixture memo sends some runs to lint and test the manager repo) adds cost noise, not check noise.

## Record per run

On the first attempt, confirm that the `system/init` event in its `raw.jsonl` lists no `WebFetch` or `WebSearch` tool. If it lists either, the web tools were not off: stop the run before the next attempt.

## Exclusions

Carried over from `bench/experiments/security-fix-cold/RUBRIC.md` and `bench/experiments/multi-stack-repo-cold-2/RUBRIC.md`, with the inconclusive threshold adapted to two scenarios, plus the last bullet.

- Harness or API failures (a crash or an API error) are excluded.
- So is an attempt whose plan is not in the fixture because the agent skipped `--no-worktree`, since its plan cannot be read.
- A timeout counts as failed.
- Fewer than 8 graded attempts in a scenario makes that scenario inconclusive; topping up is the user's call.
- A timed-out attempt with no plan documents is not a plan for rules 1 and 2: it counts neither as "never names the consumer" nor as an order failure, and is listed separately. A timed-out attempt with plan documents is read as written.

## Decision rule (copied from the design, fixed before the run)

Per scenario, on the hand audit:

1. If at least 2 of 10 plans both fail the consumer check and never name the consumer, milestone 1 builds that link type (the next design). Evidence labels, the passport view and freshness are designed together with it, only as far as that link type needs them.
2. Otherwise, if the order check fails in 2 or more of 10 in plans that do name the consumer, the result is input to milestone 2's check rule, not the atlas.
3. Otherwise nothing is built for that link type.

If neither scenario meets rule 1, milestone 1 closes as measured, not built, and milestone 2 starts.
