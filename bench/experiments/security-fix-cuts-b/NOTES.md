# security-fix-cuts and security-fix-cuts-b: hand audit and ship call

Ten attempts of `security-fix`, change arm only, read as one run.
- **The attempts:** `../security-fix-cuts/` p1 to p3, plus this experiment's p1 to p7. cuts p4 to p10 were harness errors (the harness login expired mid-run), so they are excluded and were topped up here with the same skill, prompt and fixture.
- **The change:** `feat/cross-repo-releases` after the cuts in `ee61961`.
- **Setup:** claude-code with claude-sonnet-5, grader version 2. `RUBRIC.md` was committed before the run.
- **Baseline:** the paired run's `baseline-skill` arm (`../security-fix-paired/`, main at `11ec824`, 9 graded attempts, median $1.21), which was not re-run.
- **Web tools:** off in every attempt; no `system/init` listed WebFetch or WebSearch.
- **Audit:** two auditors read every plan by hand, without the grader's verdicts.

## Result

Hand verdicts, failing attempts:

| Check | Change, of 10 | Baseline, of 9 (paired) |
| :--- | ---: | ---: |
| hit-repos-covered | 0 | 9 (all mechanical) |
| fix-reaches-deploy | 0 | 6 (all mechanical) |
| right-bump | 0 | 0 |
| no-unproven-safe | 0 | 0 |
| repos-registered | 0 | 0 |
| no-manager-commands | 0 | 0 |
| cost per run, median | $1.17 | $1.21 |
| cost per run, mean | $1.15 | $1.24 |

The ship bar, fixed before the run:
- `hit-repos-covered` at most 1 of 10: **met**, 0 of 10.
- `fix-reaches-deploy` at most 1 of 10: **met**, 0 of 10.
- No new failures on the other four checks: **met**, 0 on each.
- Median cost at most $1.36 (+$0.15): **met**, $1.17.

The change meets the bar.

## What the cuts fixed

Each cause from the paired run's NOTES, against this run:
1. **E-REL-001 false positives.** They were on 9 of 9 first drafts in the paired run and 0 of 10 here. Release tasks worded "push a `v*` tag", "cut and push a new `v*` tag" and "push the next `v*` tag" passed, and so did one task that releases and then rolls out.
2. **Webshop dropped by `dep-skip`.** This happened in 4 of 9 paired runs and in none here. No attempt used `dep-skip`.
3. **One quoted keyword string printing no `deps:` block** (#65). Four attempts passed their keywords as one quoted string; research split it and the block named webshop each time.
4. **Low example tags.** In the paired run, 5 of 8 example tags were below what is deployed. Here none was. The `plan:` line's current tag (2.3.0, 1.4.2) was used.
5. **Fix rounds.** Six attempts committed on their first `pm record` with no findings. The other four took one round each: three for E-PRT-003, one for E-DEP-001 (cuts-b p3, below). Fix rounds cost $0.00 at the median, against $0.42 in the paired run.

## Findings

- **`parts: []` turns the release rules off** (cuts-b p3).
  - Its first research call had no `--repo`, so it printed no parts.
  - Its first draft gave every task `parts: []` and had no release or rollout for any image. E-REL-001 and E-REL-002 stayed silent, because they start from the parts a task changes.
  - E-DEP-001 fired on orders and webshop, worded "no task in this epic changes it", although T03 and T04 change them. A repo counts as changed only through parts.
  - The planner followed the hint, ran research with `--repo`, and added all six release and rollout tasks. The final plan passes.
  - A `parts: []` draft whose package no other registered repo carries would draw neither finding, and would commit with no release.
- **The storefront rollout's check names webshop.** The `plan:` line for `argocd/workloads/storefront` shows the checks `kustomize build workloads/webshop | ./kubeconform ...`. That is argocd's own CI (`.github/workflows/validate.yml`), which validates only the webshop workload; pm reports it as the repo-wide check. cuts-b p5 copied it into its rollout task, p4 flagged it, and three others rewrote it to `workloads/storefront`.
- **The Go builder.** No plan moves orders' `golang:1.22` builder or its `go 1.22` line, and none uses websocket v1.5.3. By the rubric's case, every orders `make release` would fail at build. This is judgment and ungraded, as in the cold and paired runs.
- **Network.** No agent ran an install, `go get`, docker, a scanner, `curl` or `gh`. pm research's own `gh` probe reached GitHub, as before.
- **The manager lint detour (#61).** It ran in 4 of 10, against 4 of 9 in the paired change arm.

## Grader disagreements

The hand verdict stands. Each is a grader-version-2 false failure, and grader version 3 (#69) passes each:
- cuts-b p3, `no-unproven-safe`: it read an out-of-scope line ("Changing orders' Dockerfile or base image: unaffected by this finding") as an uncited safety claim. orders is fixed in the same task.
- cuts-b p4, `right-bump`: it read the current versions quoted in T03 and T04 (`require golang.org/x/net v0.17.0 // indirect`, and v0.23.0 for webshop) as the chosen ones. The tasks move x/net to 0.36.0 or later.
- cuts-b p5, `fix-reaches-deploy`: "orders Go: the release does not wait for the fix". T08 (orders release) depends on T02 (the orders fix), but T03's title says webshop has the "same CVE as orders", so the grader took T03 as an orders fix.
- cuts-b p5, `no-unproven-safe`: T05 says webshop is not affected because it builds from `golang:1.23` and `gcr.io/distroless/static`. Version 2 took only dependency files as a citation, never what an image builds from. Its evidence quoted the start of the paragraph, the restated finding, which hid the claim.

## Grader version 3

Version 2 disagreed with the hand audits in 8 verdicts across the 38 saved security-fix plans: the four above, and four in `../security-fix-paired/NOTES.md`. Version 3 agrees with every verdict of all 38, and changes none of the cold run's. Each fix has a test from a run's own wording, and each test failed first.
- **fix-reaches-deploy:** "same ... as orders" in another repo's task ("the same CVE as orders", "the same CVE-2025-22870 class as orders") names orders without working there.
- **right-bump**
  - A version a repo has now (`require golang.org/x/net v0.17.0 // indirect` in orders) is where it starts, not a choice.
  - "bump the `express` version to the first release line that ..." names the parent by rule.
  - A `FROM` line moved to "a tag whose Alpine base reports `libssl3 >= 3.3.3-r0`", or "moving to the next patch tag", is a base move.
- **no-unproven-safe**
  - In the task that fixes orders, "Changing orders' Dockerfile or base image: unaffected by this finding" is the task's scope, not a claim.
  - "The currently-locked `requests` version" cites the lockfile, and what a repo builds from (its Dockerfile, "builds from `golang:1.23`") cites a claim about the base image.

## Cost by phase

Input side, at the prices that reproduce `costUsd`, over the 10 attempts:

| Phase | Median | Paired change arm | Paired baseline |
| :--- | ---: | ---: | ---: |
| Drafting the first plan | $0.52 | $0.49 | $0.52 |
| Fix rounds after the first `pm record` | $0.00 | $0.42 | $0.10 |
| Manager lint detour | $0.00 | $0.00 | $0.24 |
| Tool calls | 31 | 61 | 43 |
