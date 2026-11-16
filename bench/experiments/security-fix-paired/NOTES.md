# security-fix-paired: hand audit and ship call

Twenty attempts of `security-fix`, ten pairs. `with-skill` is the change on `feat/cross-repo-releases` at the manifest's `de8d06e` (skill `sha256:e264e4af...`), with profiles at format 3. `baseline-skill` is main at `11ec824`, with format-2 profiles refreshed by its own pm.
- **Setup:** claude-code with claude-sonnet-5, grader version 2. `RUBRIC.md` was committed before the run.
- **Excluded:** p10 in both arms, which hit the account's usage limit (`429 usage_limit_reached`). The rubric excludes API failures, which leaves 9 graded attempts per arm, enough to decide (8 is the floor).
- **Web tools:** off in every attempt; no `system/init` listed WebFetch or WebSearch.
- **Audit:** two auditors read every plan by hand, without the grader's verdicts.

## Result

Hand verdicts, failing attempts of 9:

| Check | Change | Baseline |
| :--- | ---: | ---: |
| hit-repos-covered | 4 (all judgment) | 9 (all mechanical) |
| fix-reaches-deploy | 0 | 6 (all mechanical) |
| right-bump | 0 | 0 |
| no-unproven-safe | 0 | 0 |
| repos-registered | 1 (judgment) | 0 |
| no-manager-commands | 0 | 0 |
| cost per run, median | $1.67 | $1.21 |
| cost per run, mean | $1.79 | $1.24 |

The ship bar, fixed before the run:
- `hit-repos-covered` at most 1 of 10: **missed**, 4 of 9.
- `fix-reaches-deploy` at most 1 of 10: **met**, 0 of 9.
- No new failures on the other four checks: **missed**, repos-registered 1 against 0.
- Median cost at most +$0.15: **missed**, +$0.46.

The change does not ship as is. The ship call goes to the user.

## What worked

- **The release link and its `plan:` line.** Storefront's tag release and argocd `newTag` rollout were in all 9 of the change arm's first drafts, in order, against 3 of 9 final plans on baseline. No rule finding was needed for them.
- **The facts reached every planner.**
  - The `deps:` block, or E-DEP-001 where the block did not print, put webshop's `golang.org/x/net` v0.23.0 in front of every change-arm planner.
  - E-DEP-001 fired in 6 of 9 and was right each time.
  - No change-arm failure is mechanical, and there was no rule false negative: wherever a plan failed, the rule had fired.

## Why it missed the bar

1. **E-REL-001 was a false positive on all 9 first drafts.** E-REL-002 and some E-PRT-003 findings followed from it. This is most of the extra cost: fix rounds cost $0.42 per run against $0.10 (median), while drafting cost the same ($0.49 against $0.52). The release task was always there, so the rule (tightened in `08290e1` after review) misread it:
   - **The tag wording.** Every draft wrote "push a `v*` tag", the wording of research's own `plan:` line and of the rule's fix hint. The rule demands a version with a digit after `v`.
   - **One task doing both.** p3 and p5 used one task that both releases and rolls out, which the rubric passes. The rule rejects any rollout task as the release.
   - **Line breaks.** A line break inside the wording ("push a new / version tag") defeated the pattern.

   Several attempts then read `check.ts` to understand the finding. p8 added debug lines to the skill's `check.ts` and removed them later.
2. **Webshop was dropped on purpose in 4 of 9** (p4, p5, p7, p9). Each planner had the fact and answered E-DEP-001 with `dep-skip`, giving the reason "not in the scan's flagged list". `dep-skip` accepts any reason, and nothing tells the planner that the scan not naming a repo is no proof the repo is unaffected.
3. **One quoted keyword string printed no `deps:` block** (p1, p5, p6, p8). Each passed several keywords as one argument, such as `"golang.org/x/net x/net"`, which matches no package. This is #65. E-DEP-001 caught webshop later in those runs, at a fix round's cost.
4. **The `dep-skip` hint breaks on commas.** The hint shows the inline form `dep-skip: ["webshop: <why>"]`, which breaks on a reason that contains a comma. That cost p4, p5 and p7 an extra round each.
5. **argocd tasks without argocd in `repos:`** (p8: the new repos-registered failure). `partRules` now loads a rollout repo's parts even when `repos:` lacks it, so `pm check` accepted those tasks.

## Other findings

- **Example tags in the plans.** To satisfy E-REL-001, planners wrote example version tags. 5 of 8 are below what is deployed now (storefront 2.3.0, webshop 1.4.2), because the `plan:` line does not show the current tag.
- **No `VERSION` bump.** Most plans in both arms run orders' `make release` without bumping `VERSION`, as in the cold run. That is #64, ungraded here as in the cold run.
- **The Go builder.** None of the 18 moves orders' `golang:1.22` builder or uses websocket v1.5.3. p1 with, p8 with, p2 base, p4 base and p9 base explicitly keep Go 1.22. Recorded as judgment, per the rubric.
- **Network attempts.**
  - p7 with ran `npm view express` and p9 with ran `bun install` in a manager copy; both were refused offline.
  - pm research's own `gh` probe reached GitHub, as before.
- **The manager lint detour (#61).** It ran in 4 of 9 change-arm runs and 6 of 9 baseline runs.

## Cost by phase

Input side, at the prices that reproduce `costUsd`, over the 9 graded pairs:

| Phase | Change, median | Baseline, median |
| :--- | ---: | ---: |
| Drafting the first plan | $0.49 | $0.52 |
| Fix rounds after the first `pm record` | $0.42 | $0.10 |
| Manager lint detour | $0.00 | $0.24 |
| Tool calls | 61 | 43 |

## For the next round

Each cause above is mechanical or wording, and each has a cheap fix:
- **Accept the release task as written.** Count "push a `v*` tag" and the trigger pattern itself as the release, count a task that both releases and rolls out, and read across line breaks.
- **Make `dep-skip` ask for evidence.** E-DEP-001's hint says the scan not naming a repo is no reason, and the skill says a `dep-skip` reason must say why that repo is not affected or not deployed.
- **Split a quoted keyword string into words** (#65).
- **Show `dep-skip` in list form** in the hint.
- **Require the rollout repo in `repos:`:** a finding when a task has parts in a repo the epic's `repos:` lacks.
- **Show the current tag value** in the `plan:` line.

Then a cuts run, the change arm only, compared with this run's baseline, as #16 did.
