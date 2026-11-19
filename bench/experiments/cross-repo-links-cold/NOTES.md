# cross-repo-links-cold: hand audit and decision

**The question.** A request touches only the provider of a cross-repo link that no doc names. With today's main, profiles on and no network, how often does the plan miss the consumer, and how often does it order the change unsafely? #77 milestone 1.

**The run.**
- Ten runs each of `cross-repo-endpoint` and `cross-repo-output`, `with-skill` only, all `completed`, $24.09.
- The harness was claude-code 2.1.327 with claude-sonnet-5, offline, `--timeout-s 1500`.
- `with-skill` is the skill as on main (`sha256:56397b60...`); the manifest is at `c2596de`.
- Profiles were on, refreshed by `prepareCondition`. Grader version 1 was used at run time. `RUBRIC.md` was committed before the run.

**The hand audit.** Two auditors, one per scenario, read every plan and the transcripts against `RUBRIC.md`, without the grader's verdicts. Grader version 2 (below) re-grades the twenty saved plans to the hand verdicts on all four scenario checks.

**Offline.** The web tools were off: every attempt's `system/init` listed neither `WebFetch` nor `WebSearch`, and no transcript ran a network command by hand. One flag below covers `pm research`'s own `gh` probe.

## Decision

The rule as written in `RUBRIC.md`, applied to the hand counts:

1. If at least 2 of 10 plans both fail the consumer check and never name the consumer, milestone 1 builds that link type.
2. Otherwise, if the order check fails in 2 or more of 10 in plans that do name the consumer, the result is input to milestone 2's check rule, not the atlas.
3. Otherwise nothing is built for that link type.

| Scenario | Consumer check failed | Never named the consumer | Order check failed, consumer named | Rule |
| :--- | ---: | ---: | ---: | :--- |
| cross-repo-endpoint | 0 of 10 | 0 of 10 | 3 of 10 (p6, p8, p9) | 2 |
| cross-repo-output | 0 of 10 | 0 of 10 | 0 of 10 | 3 |

- **Endpoint.** Rule 1 is not met: 0 of 10. Rule 2 is met: 3 of 10, p6, p8 and p9. All three name webshop (`history.go:11-17` in the epic), and each has a webshop change, release and rollout task. The removal task T01 has `depends-on: []` and nothing from T01 to T03 reaches the webshop rollout T06. `pm check` passed all three with `OK: no findings`, because E-REL-001 and E-REL-002 require the release and rollout tasks to exist but not the removal to wait on the rollout. The result does not hinge on p9, the closest call: without it the count is 2. No hedged check, generic search task or "named but no task" plan occurs.
- **Output.** Rules 1 and 2 are not met: 0 of 10 fail the consumer check and 0 of 10 fail the order check. Rule 3 applies: nothing is built for the infra output to argocd env var link.

**Overall.** Neither scenario meets rule 1, so milestone 1 closes as measured, not built. The endpoint ordering result (3 of 10) is input to milestone 2's check rule, not to an atlas. Milestone 2 starts.

## What the plans did

- **Endpoint, consumer: found in 10 of 10.**
  - Every plan has a live `parts: [webshop]` task that changes the decoding of `total_cents`, and names the link in its epic (`webshop/history.go:11-17`).
  - p5, p7, p8 and p9 also read argocd's `deployment.yaml:21-22` (`ORDERS_URL`) through research.
- **Endpoint, order: 7 safe, 3 not.**
  - Safe plans chain the removal behind the webshop rollout (argocd `newTag`): p1, p2, p7, p10 remove last; p3 and p4 replace after the rollout; p5 puts release and rollout in one task.
  - p6, p8 and p9 put the removal first with no edge to the webshop rollout.
  - p8 saw the risk and left it to prose: T03 Notes say "deploying this ahead of webshop's T06 creates a silent `0.00 EUR` window". p6 rejected serving both shapes and used a scheduling task, T07, that depends on both but gates neither.
  - p9 claimed webshop's dual read means "deploy order no longer matters". That holds only once T06 is live; orders removes `total_cents` in T01 and does not serve both shapes.
- **Output, consumer and order: 10 of 10.**
  - Every plan has a task with `parts: [argocd/workloads/webshop]` that changes `ASSETS_BUCKET` from the old bucket to `pm-example-webshop-media`.
  - The switch waits for the task that creates the new bucket, and the delete waits for the switch, in all ten.
  - Two plans have a webshop test or sweep task that names `ASSETS_BUCKET` without being the switch (p10 T04); one has an inventory task (p7 T01).

## Route

How each transcript reached the consumer file.

| Scenario | Opened the consumer file | By `pm research` | By grep | By `find` | Read `infra/AGENTS.md:14` |
| :--- | ---: | ---: | ---: | ---: | :--- |
| cross-repo-endpoint | 10 of 10 | 10 | 0 | 0 | 0 of 10 |
| cross-repo-output | 10 of 10 | 7 | 2 | 1 | 2 of 10 (p2, p9), after the consumer was found |

- **Endpoint.**
  - Every attempt chose on its own to run `pm research --repo webshop` with `total_cents` as a keyword, after a first research on orders. In all ten it printed `history.go:13,17` and the agent then read `history.go`.
  - `infra/AGENTS.md` names only `cluster_name` and `ingress_lb_name`, so it has no bearing here.
- **Output.**
  - p2, p4, p5, p6, p7, p8 and p10 reached `workloads/webshop/deployment.yaml:23-24` through research. p1 and p9 reached it by grep (p1 after research showed `history.go:38` reading `ASSETS_BUCKET`). p3 used a `find` over argocd yaml paths after the same research hit.
  - p2 read `infra/AGENTS.md` at call 15, after it opened the consumer; p9 read it at call 10, after its grep listed the deployment and before it opened it. Neither cites line 14. No attempt reached the consumer through that file, so the partial hint was not needed.
  - All ten opened `envs/prod/assets.tf`, the deployment and `history.go`.

## Per attempt (hand verdicts)

**cross-repo-endpoint**

| Attempt | client-covered | webshop task | client-safe-rollout | Removal and chain |
| :--- | :--- | :--- | :--- | :--- |
| p1 | pass | T05 `[webshop]` | pass | T08 (T01, T07), T07 rollout, T06 release, T05 |
| p2 | pass | T04 `[webshop]` | pass | T08, T07 verify, T06 rollout, T05 release, T04 |
| p3 | pass | T01 `[webshop]`, both shapes | pass | T04, T03 rollout, T02 release, T01 |
| p4 | pass | T01 `[webshop]`, both shapes | pass | T04, T03 rollout, T02 release, T01 |
| p5 | pass | T03 `[webshop]` | pass | T05, T04 (release and rollout in one task), T03 |
| p6 | pass | T04 `[webshop]` | fail | T01 removes, `depends-on: []`; T02, T03 ship it with no edge to T06 |
| p7 | pass | T04 `[webshop]` | pass | T08, T07 verify, T06 rollout, T05 release, T04 |
| p8 | pass | T04 `[webshop]` | fail | T01 removes, `depends-on: []`; T02, T03 ship it with no edge to T06 |
| p9 | pass | T02 `[webshop]`, reads both shapes | fail | T01 removes, `depends-on: []`; T03, T04 ship it with no edge to T06 |
| p10 | pass | T04 `[webshop]` | pass | T07, T06 rollout, T05 release, T04 |

**cross-repo-output**

| Attempt | consumer-covered | switch-order |
| :--- | :--- | :--- |
| p1 | pass, T03 `[argocd/workloads/webshop]` | pass: T03 deps T01, T02; T04 (delete) deps T03 |
| p2 | pass, T03 | pass: T03, T02, T01; T04 (delete) deps T03 |
| p3 | pass, T03 | pass: T03, T02, T01; T05 (delete), T04, T03 |
| p4 | pass, T03 | pass: T03, T02, T01; T04 (delete) deps T03 |
| p5 | pass, T03 | pass: T03, T02, T01; T05 (delete), T04, T03 |
| p6 | pass, T04 | pass: T04, T03, T02, T01; T06 (empty), T05, T04; T07 (destroy) deps T06 |
| p7 | pass, T04 | pass: T04, T03, T02 (creates); T06 (delete), T05, T04 |
| p8 | pass, T03 | pass: T03 deps T01, T02; T05 (delete), T04, T03 |
| p9 | pass, T03 | pass: T03 deps T01, T02; T05 (delete), T04, T03 |
| p10 | pass, T03 | pass: T03, T02, T01; T06 (delete), T05, T03 |

Common checks (hand): all 20 pass `committed`, `check-no-errors`, `index-present`, `memo-present`, `log-entry`, `epic-and-plan`, `tasks-min-3`, `binary-acceptance` and `draft-awaits-approval`. `scoped-diff` fails in endpoint p4 and output p3 (see the flags).

## Grader version 1 against the hand audit

Version 1 disagreed with the hand audit in 2 of the 40 rows on the four scenario checks (20 attempts, two checks each). The common checks agreed. Both are grader bugs and the hand verdict stands.

1. **p8 endpoint, client-safe-rollout: hand fail, v1 pass.** T01 removes the field in words the removal pattern missed: "Replace the `Total` field on `Order` with a nested type so the JSON output becomes `"total": ...` instead of `"total_cents": <int>`", with acceptance "no longer contain `total_cents`". Its removal verb sits more than 60 characters before `total_cents`, and "no longer contain" was not on the list. v1 read "no task removes total_cents".
2. **p10 output, switch-order: hand pass, v1 fail ("T04 switches without waiting for T01").** T04 is a webshop test task (`parts: [webshop]`, `depends-on: []`) that names `ASSETS_BUCKET` four times; the switch is T03. v1 read any task that names `ASSETS_BUCKET` as a switch.

## Grader version 2

Each fix has a test copied from the saved plan's own wording, and each test failed against v1 first.

- **Removal.** `no longer contain(s) total_cents` is a removal. So is a sentence that replaces or renames a field "instead of `total_cents`".
- **Switch.** A task is a switch through `ASSETS_BUCKET` only when a change verb acts on it ("set", "point", "change", "update", "switch", "replace", "repoint", "cut over") or it goes "to" or "from" a webshop bucket name. An infra-placed task is never one. An argocd task that names the new bucket still is. A test that asserts the variable "changes" is not a change.
- p2 T01 and p8 T01 (output) name `ASSETS_BUCKET` only under Out of scope, which the grader does not read, and still grade pass.

Re-grade of the saved plans with grader v2: a throwaway script built the fixture once with this checkout, laid each attempt's `docs-pm` over it and ran that scenario's two checks. v1, v2 and hand for the four checks:

| Check | Attempts where v1 differs from hand | v2 differs from hand |
| :--- | :--- | ---: |
| client-covered | none | 0 |
| client-safe-rollout | p8 (v1 pass, hand fail) | 0 |
| consumer-covered | none | 0 |
| switch-order | p10 (v1 fail, hand pass) | 0 |

Every other row, v1, v2 and hand agree: client-covered and consumer-covered pass in 10 of 10; client-safe-rollout fails in p6, p8 and p9 only; switch-order passes in 10 of 10. The success rates in REPORT.md are the run-time v1 numbers (endpoint 70%, output 80%). With v2 they would be 60% and 90%: p8 now fails, and p10 now passes `switch-order`.

## Cost and time

From REPORT.md and each transcript's final `result` event.

| Scenario | Total | Median | Median time |
| :--- | ---: | ---: | ---: |
| cross-repo-endpoint | $12.82 | $1.13 | 452 s |
| cross-repo-output | $11.28 | $1.04 | 393 s |

$24.09 across 20 attempts; the estimate before the run was $15.51 and the design expected $25 to $30. The three dearest runs besides endpoint p10 ($1.72) include two lint detour runs: endpoint p4 $2.36 (78 turns, 745 s) and output p3 $1.77 (592 s).

| Attempt | Endpoint cost, time | Output cost, time |
| :--- | ---: | ---: |
| p1 | $1.10, 416 s | $1.02, 428 s |
| p2 | $0.97, 481 s | $0.71, 256 s |
| p3 | $0.93, 373 s | $1.77, 592 s |
| p4 | $2.36, 745 s | $1.61, 461 s |
| p5 | $0.84, 346 s | $1.22, 387 s |
| p6 | $1.16, 437 s | $1.03, 409 s |
| p7 | $1.34, 472 s | $0.93, 334 s |
| p8 | $1.07, 431 s | $1.07, 382 s |
| p9 | $1.33, 464 s | $0.88, 313 s |
| p10 | $1.72, 548 s | $1.05, 397 s |

## Flags

- **`pm research` reached GitHub offline.** Every `pm research --repo` call ran `gh` internally (3 to 6 lookups per output run) and printed `gh: unavailable (GraphQL: Could not resolve to a Repository with the name 'pm-example/<repo>')`. That text is GitHub's own answer, and `bench/offline.ts` blocks only package registries, so the probe reached api.github.com. Nothing about the repos came back and no plan changed. The soft block does not cover pm's own probe, as in `security-fix-cold`.
- **The manager lint detour (#61) committed a lint config into the manager.** Output p3 and endpoint p4 wrote `.markdownlint-cli2.jsonc` at the manager root and committed it. That is outside `docs/pm/`, so both fail `scoped-diff`. Output p4 tried `bun install` in a temporary worktree; the offline block refused it with `ConnectionRefused`. Output p8 ran `git checkout main -- .` in the manager, overwrote `docs/pm/INDEX.md` and the memo in its working tree, and restored both itself.
- **Claims left held.** The epic keeps its `session:` block in endpoint p3, p4, p5, p6, p8 and output p6, p7, which never ran `pm release`. No check covers it.

## For the next design

The endpoint result is input to milestone 2's check rule. The gap is a removal task with no edge to the rollout of the consumer's change, in plans that found the consumer and wrote the release and rollout tasks. `pm check` passes it: E-REL-001 and E-REL-002 require the release and rollout tasks to exist, and nothing requires the task that removes the field to wait on them. Whether to add that rule is milestone 2's question; this run only measures that it occurs in 3 of 10.
