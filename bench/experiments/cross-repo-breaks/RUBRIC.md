# cross-repo-breaks: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-23-breaks-rule-design.md` (#77 milestone 2, the measured slice). Grader: `bench/graders/cross-repo-links.ts`, version 2, unchanged. Baseline: `bench/experiments/cross-repo-links-cold` (its `RUBRIC.md` and `NOTES.md`).

## Question

With `breaks:` and the rules E-BRK-001/002 in the skill (repo `a1353d9`), on the same two scenarios as the cold run:

- how often is the endpoint removal of `total_cents` still ordered before webshop's rollout (cold: 3 of 10);
- does the output scenario stay safe in 10 of 10;
- at what extra median cost?

## What changed since the cold run

- A task may declare `breaks: [<repo id>]`: the other registered repos whose running code reads what it removes or reshapes (`references/task.template.md`, `references/research.md`).
- `pm check` and `pm record` fail such a task when it cannot reach, through `depends-on`, that repo's rollout after its release, or its change tasks when it ships no release (E-BRK-001); an unknown id, a repo the epic's `repos:` does not list, or the task's own repo is E-BRK-002. Tasks that depend on the breaking task are never required. A task in the folder that rolls the repo's image out (argocd `workloads/webshop`) counts as that repo's.
- Nothing else in the skill, the scenarios, the fixture or the grader changed.

## The links

As in the cold run. Both links are in the overlay under `bench/scenarios/fixtures/cross-repo-links/`; no README, AGENTS.md, memo, epic or commit message names either.

| Scenario | Provider | Consumer (file and line) | Correct plan |
| :--- | :--- | :--- | :--- |
| cross-repo-endpoint | orders `internal/orders/store.go:12`, `json:"total_cents"`, served by `List` at `:23` for `GET /orders` | webshop `history.go:13` decodes `total_cents`, called from `history.go:17` (`ORDERS_URL` + `/orders?customer=`), route in `main.go:15`; test in `history_test.go:16`. The address is argocd `workloads/webshop/deployment.yaml:21-22` | Webshop reads the new `total` object (or both shapes), tags a release and rolls it out (argocd `newTag`). Orders removes `total_cents` only after that rollout, or serves both shapes and defers the removal |
| cross-repo-output | infra `envs/prod/assets.tf:2`, `bucket = "pm-example-webshop-assets"`, output `webshop_assets_bucket` at `:5` | argocd `workloads/webshop/deployment.yaml:23-24`, `ASSETS_BUCKET: pm-example-webshop-assets`; read in webshop `history.go:38` | Create `pm-example-webshop-media` (versioning on, noncurrent versions expire after 90 days); set `ASSETS_BUCKET` to it in argocd and roll it out; delete the old bucket last, after the switch |

## Check definitions

The cold rubric's definitions, with the two amendments its `NOTES.md` made in grader version 2. The hand audit is the authority: where the grader differs, the hand verdict stands.

**cross-repo-endpoint**

- `client-covered`: a live task changes webshop's decoding of `total_cents` (its `parts:` names a webshop part, or its text names webshop and the field or the new shape).
- `client-safe-rollout`: no live task removes `total_cents` from orders' response unless it depends, directly or transitively, on the task that rolls webshop's change out (argocd `newTag`), or on the webshop change task when that same task also releases and rolls out. A plan that serves both shapes and defers removal passes. A plan that removes `total_cents` with no webshop task fails.
- The chain must hold: the removal reaches a rollout, and that rollout is, or reaches, a webshop change task. An argocd `newTag` task with no edge to the webshop change or release does not unlock the removal.
- A removal task is one that asks for the removal itself ("remove", "replace", "stop returning", "no longer includes" `total_cents`). Grader version 2: "no longer contain(s) `total_cents`" is a removal, and so is a sentence that replaces or renames a field "instead of `total_cents`". A sentence that says the removal comes later or from another task is a reference, not a removal. Keeping is read only where `total_cents` is the object ("keep `total_cents`", "alongside `total_cents`", "both shapes").

**cross-repo-output**

- `consumer-covered`: a live task changes `ASSETS_BUCKET` in argocd's webshop deployment: its `parts:` names that argocd part, or its text names `ASSETS_BUCKET` or `workloads/webshop/deployment.yaml`.
- `switch-order`: that task depends, directly or transitively, on the task creating the new bucket, and the task deleting the old bucket depends on it. A plan that deletes the old bucket with no such task fails.
- Grader version 2 reads the switch by placement: a task placed in argocd that names `ASSETS_BUCKET` is the switch unless the mention is negated; a task not placed in argocd is the switch only when a change verb acts on `ASSETS_BUCKET`, or it goes to or from a webshop bucket name; an infra task not also in argocd never is. A mention only under Out of scope is not read.

**Hedged checks, hand verdicts.** As in the cold rubric: a conditional or search task fails the consumer check and does not name the consumer unless the plan states the link elsewhere; a plan that names the consumer but has no task for it fails its order check; a plan that never names the consumer and has no removal (endpoint) or delete (output) task gets n/a on its order check; `client-safe-rollout` has no skip.

## Per attempt

Read `artifacts/<attempt>/docs-pm/` (epic, plan, tasks) and the transcript (`raw.jsonl`), without the grader's verdicts. One row per attempt:

| Attempt | Consumer check | Order check | Source | `breaks:` declared (task, ids) | E-BRK rounds | E-BRK findings, right? | Common checks | Cost, time |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| | pass / fail | pass / fail / n/a | file or research line | e.g. T01 `[webshop]`, or none | n | rule, task, and whether the plan was in fact unsafe | failures only | |

- **Consumer check** is `client-covered` (endpoint) or `consumer-covered` (output); **order check** is `client-safe-rollout` or `switch-order`.
- **Source:** the transcript opened the file that holds the fact, or `pm research` output showed it (`history.go` or `main.go` in webshop, `workloads/webshop/deployment.yaml` in argocd, `envs/prod/assets.tf` in infra, `internal/orders/store.go` in orders). A pass with no traceable source is "passed, source unclear".
- **E-BRK rounds:** how many `pm record` or `pm check` outputs carried an E-BRK finding before the last one passed.
- **E-BRK findings, right?:** each E-BRK finding the run met, and whether the plan it flagged was in fact unsafe (a right finding) or safe (a false failure). Every E-BRK finding in `cross-repo-output` is listed, right or not.
- **Common checks:** `scoped-diff`, `committed`, `check-no-errors`, `index-present`, `memo-present`, `log-entry`, `epic-and-plan`, `tasks-min-3`, `binary-acceptance`, `draft-awaits-approval`; list only failures.

Every failed consumer check gets one class from the cold rubric (never names, passing mention, generic search task, hedged check, named but no task).

## Pinned state

The manifest's fixture hash covers only the manager repo; the targets' trees are pinned by `bench/tests/scenario-cross-repo-links.test.ts`:

| Repo | Tree |
| :--- | :--- |
| webshop | `4d88d84fa27c39a732a74be1cfea4228401fe591` |
| infra | `7f5dce1a19c5e19dbc2f0eb50979bf08ababd69c` |
| argocd | `96e4411de7aa82732570eaf3444195ba1b7de2ce` |
| orders | `1f2d57094944e2ae949a2c9ff5512aaca523b407` |

Manifest: `cross-repo-breaks`, claude-code 2.1.330, `claude-sonnet-5`, condition `with-skill`, 10 pairs, `--timeout-s 1500`, offline, isolation `config-dir`. Both scenarios at version 2, grader version 2, repo `a1353d9`, not dirty, fixture hash `sha256:4586c28d5d2b443e769fba3b260fa153af12c2c9c70a31d01efc15b77fcf684b` (the cold run's). 20 planned attempts. Estimate before the run: $15.51 (`experiment run` without `--yes`); the cold run estimated the same and cost $24.09.

## Harness

The cold run used claude-code 2.1.327; this run uses 2.1.330, recorded and not pinned (user, 2026-11-23). If only bar 3 misses, the audit separates the cost of E-BRK fix rounds (from the per-attempt rounds above) from the rest before calling it.

## Record per run

- On the first attempt, confirm that `system/init` in `raw.jsonl` lists no `WebFetch` or `WebSearch`. If it lists either, stop the run before the next attempt.
- `pm research`'s own `gh` probe reached GitHub in the cold run (no data came back). Record it again if it recurs; it does not stop the run.
- #61's lint detour (the fixture memo sends some runs to lint the manager repo) adds cost noise, not check noise; record which attempts took it.

## Exclusions

As in the cold rubric:

- Harness or API failures (a crash or an API error) are excluded.
- So is an attempt whose plan is not in the fixture because the agent skipped `--no-worktree`.
- A timeout counts as failed. A timed-out attempt with no plan documents is listed separately and counts toward no bar condition; one with plan documents is read as written.
- Fewer than 8 graded attempts in a scenario makes that scenario inconclusive; topping up is the user's call.

## Bar (copied from the design, fixed before the run)

1. `cross-repo-endpoint`: `client-safe-rollout` fails in at most 1 of 10 plans (cold: 3 of 10).
2. `cross-repo-output`: `consumer-covered` and `switch-order` pass in 10 of 10 (cold: 10 of 10).
3. Median cost per scenario at most $0.20 above the cold run's: endpoint at most $1.33 (cold $1.13), output at most $1.24 (cold $1.04).

Ship only if all three hold.

Counts come from the hand audit; medians from `REPORT.md` (each attempt's final `result` event).

## If the bar is missed (copied from the design)

The audit says why, using the diagnostics: never declared, declared and still misordered, or the rule's cost. One revision of the guidance or the rule, then one more measured run under the same bar. If that misses too, stop and bring it to the user; nothing ships unmeasured.
