# multi-repo-context-asis: hand audit and decision

Ten runs of `multi-repo-context-asis`, all `completed`: claude-code, claude-sonnet-5, skill 0.11.0 (`sha256:e25d9b2a...`, identical to main), repo `e817a05`, timeout 1500 s, grader version 2. `RUBRIC.md` was committed before the run. Every plan was read by hand against it; where the hand verdict differs from the grader, the hand verdict stands.

## Decision

| Check | Cold, hand | As-is, grader | As-is, hand |
| :--- | ---: | ---: | ---: |
| own-checks-webshop | 0 | 2 | 1 (p8) |
| own-checks-infra | 0 | 1 | 0 |
| own-checks-argocd | 1 | 1 | 0 |
| no-manager-commands | 0 | 1 | 0 |
| conventions | 0 | 2 | 1 (p1) |
| cross-repo-order | 3 | 2 | 2 (p4, p8) |
| repos-registered | 0 | 1 | 0 |

`cross-repo-order` failed twice with the memo as the story leaves it, so by the rule the memo does not cover the gap, and part 4 (relationship map) is the next design. The rubric's second clause applies too: both failures state the order in their own text and drop the `depends-on` edge, as two of the three cold failures did. Across the twenty runs, four of the five failures had the knowledge a relationship map would add. The design note for part 4 has to say so, because the evidence points at turning the order a plan already states into `depends-on` edges, not at giving it more knowledge.

The other checks stay at one failure or none: nothing is built for them.

## p9 graded from its transcript

p9 claimed with `--no-worktree`, recorded the spec, then ran `pm release` and `git checkout main`, so the fixture's `main` held no new epic and the grader failed every epic check. The rubric excludes a plan that cannot be read; this one can: its single `pm record --from -` bundle holds the epic, plan and all seven tasks, and only the memo was edited after it. The plan was rebuilt from that bundle and graded with version 2 and by hand. Without p9 the result is the same: two `cross-repo-order` failures in nine.

The agent read `webshop-healthcheck/epic.md` and the changelog (which shows that epic claimed, specced and released) just before releasing, so the as-is history probably prompted the release. The cold fixture has no released epic on `main`, and no cold run released.

## The two cross-repo-order failures

- p4: T05 (the 10% switch) depends on T03 (canary workload), which depends on T02 (load balancer). T01 (version reporting) is upstream only of T06, which measures the split afterwards. `plan.md` says "Must: T01: nothing downstream can be verified (which pod answered?) without version reporting." The grader passed p4 because T06 mentions "10%" and does reach T01 (bug below).
- p8: T06 (the switch) depends on T03 (canary Deployment, no dependencies) and T05 (Service and hostname, which reaches T04, the load balancer). T01 and T02 (version endpoint, release tag in the binary) are upstream of nothing. `plan.md` says "Must: T01, T02 (version reporting: every later milestone needs it ...".

Every attempt ran `pm status`, which prints the memo with "`webshop` to `argocd`: a release reaches the cluster only when `newTag` is bumped".

## Other misses

- p8 `own-checks-webshop`: T01 and T02 name `go build` and `docker build` and "a test ... following the existing `TestHealthz` pattern", but no `make test`, `make lint`, `go test` or `golangci-lint`, although the memo names them.
- p1 `conventions`: no task, plan line or epic line routes the infra change through CI or a pull request, and none says not to apply from a workstation. p1 never read infra's `AGENTS.md`; `main`'s memo has no infra line (it is on the staging epic's branch). p9 also never read `AGENTS.md` but wrote "Apply it through the normal infra PR + CI process": pass, source unclear.
- p9's infra task has "`terraform plan` in `envs/prod` shows exactly one new `hcloud_load_balancer`" as an acceptance criterion; with "Apply it through the normal infra PR + CI process" in the same task, that reads as the plan CI posts: pass, noted.

## Sources

- webshop and argocd checks: first seen in `pm status` output (the memo) in all ten attempts. In the cold run they came from the target repos and `pm research`.
- infra checks and the CI-only apply rule: infra's `AGENTS.md` in eight attempts (p2, p3, p4, p5, p6, p7, p8, p10); p1 and p9 never saw the rule.
- Eight attempts (all but p1 and p9) ran commands in the staging epic's worktree, whose copy of the memo has infra's conventions. p1 and p9 are also the two that never saw infra's `AGENTS.md`.
- Nine attempts (all but p4) again passed several `--repo` flags to one `pm research` call (#53).

## Grader bug (version 2; not fixed)

5. `cross-repo-order` treats any argocd task that mentions "10%" or a weight as a switch, and passes if any one of them depends on both the release and the load balancer. In p4 that was T06, which validates the split after T05 makes it. False pass. A fix needs care: picking only the earliest switch, or requiring every switch to pass, misreads a canary workload that names `newTag` and rightly does not wait for the load balancer. It waits for the next run of this scenario.

## Context

| Attempt | Fresh tokens | Output tokens | Cost | Duration | Pre-framing context | Pre-framing tool chars | Turns |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p1 | 109153 | 42197 | $1.65 | 473s | 69664 | 55658 | 59 |
| p2 | 113154 | 46202 | $1.35 | 502s | 70843 | 67795 | 61 |
| p3 | 101890 | 39176 | $1.05 | 410s | n/a | n/a | 26 |
| p4 | 108098 | 41854 | $1.64 | 484s | n/a | n/a | 46 |
| p5 | 123376 | 45182 | $1.39 | 447s | 71723 | 97624 | 30 |
| p6 | 94259 | 35234 | $1.15 | 397s | 49361 | 45030 | 29 |
| p7 | 105004 | 37326 | $1.19 | 398s | n/a | n/a | 26 |
| p8 | 107079 | 45757 | $1.38 | 498s | 35608 | 38893 | 30 |
| p9 | 110086 | 44598 | $1.39 | 481s | 64225 | 58199 | 38 |
| p10 | 107546 | 41689 | $1.47 | 449s | 82090 | 67934 | 56 |

Against the cold run (medians from the two reports): duration 461 s against 492 s, cost $1.38 against $1.32, pre-framing context 69664 tokens (n 7) against 46460 (n 8), pre-framing tool output 58199 characters against 38871. The memo and story epics cost about 23000 more tokens of context before the first write and made no run slower or noticeably dearer. Total spend $13.67.

`pm status --harness claude-code` on a freshly built fixture (`PM_TODAY` 2026-09-15) prints 3053 characters, against 1743 for the cold fixture: the four epics, the three projects and the full memo.
