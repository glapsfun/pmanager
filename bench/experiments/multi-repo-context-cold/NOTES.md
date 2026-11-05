# multi-repo-context-cold: hand audit and decision

Ten runs of `multi-repo-context`, all `completed`: claude-code 2.1.318, claude-sonnet-5, skill 0.11.0 (`sha256:e25d9b2a...`, identical to main), repo `fbbeb17`, timeout 1500 s. `attempts.jsonl` and `REPORT.md` hold grader version 1, as run. `RUBRIC.md` was committed before the run. Every plan was read by hand against it; where the hand verdict differs from the grader, the hand verdict stands.

## Decision

| Check | Grader failures | Hand failures | Rule |
| :--- | ---: | ---: | :--- |
| own-checks-webshop | 0 | 0 | nothing built |
| own-checks-infra | 0 | 0 | nothing built |
| own-checks-argocd | 1 | 1 (p4) | nothing built |
| no-manager-commands | 0 | 0 | nothing built |
| conventions | 2 | 0 | nothing built |
| cross-repo-order | 1 | 3 (p7, p9, p10) | two or more: the as-is follow-up run comes first |
| repos-registered | 0 | 0 | nothing built |

Six of seven checks need nothing: no profile is built for commands, CI checks or conventions. `cross-repo-order` failed three times, so the rule's next step is the as-is run: the same request ten times on the full example (memo and story epics as they are), with the user's go-ahead. The full memo already says "`webshop` to `argocd`: a release reaches the cluster only when `newTag` is bumped in `workloads/webshop/kustomization.yaml`", so that run tests directly whether a memo line closes the gap. If it does not, part 4 (relationship map) is designed and rerun on this scenario with and without it.

The grader bugs below are fixed in version 2, which the as-is run uses.

## Per attempt

Verdicts are from reading the plan. Sources are from the transcript (`raw.jsonl`).

| Attempt | webshop checks | infra checks | argocd checks | no manager commands | conventions | cross-repo order | repos | Targets researched |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| p1 | pass | pass | pass | pass | pass | pass | pass | webshop, infra, argocd |
| p2 | pass | pass | pass | pass | pass (grader fail) | pass | pass | webshop, argocd |
| p3 | pass | pass | pass | pass | pass | pass | pass | argocd |
| p4 | pass | pass | fail | pass | pass | pass | pass | argocd |
| p5 | pass | pass | pass | pass | pass (grader fail) | pass | pass | webshop, infra, argocd |
| p6 | pass | pass | pass | pass | pass | pass | pass | infra, argocd |
| p7 | pass | pass | pass | pass | pass | fail (grader pass) | pass | webshop, infra, argocd |
| p8 | pass | pass | pass | pass | pass | pass | pass | webshop, infra, argocd |
| p9 | pass | pass | pass | pass | pass | fail | pass | webshop, infra, argocd |
| p10 | pass | pass | pass | pass | pass | fail (grader pass) | pass | webshop, infra, argocd |

"Targets researched" is the last `--repo` of each `pm research` call. Every attempt also read the target repos directly, so a target missing from that column was still read.

### Sources

- webshop checks (`make test`, `make lint`, `go test`): webshop's `README.md`, read directly in all ten.
- infra checks (`terraform fmt`, `terraform validate`, `tflint`) and the no-workstation-apply rule: infra's `AGENTS.md`, read directly in all ten.
- argocd checks (`yamllint`, `kubeconform`): these are only in argocd's `.github/workflows/validate.yml`. The first sighting came from `pm research` output in seven attempts (p1, p3, p5, p6, p7, p8, p9) and from reading `validate.yml` directly in two (p2, p10). p4 never saw them.
- No fact was traced to the memo or a prior epic: the fixture did not leak.

### The one argocd miss (p4)

T04 and T06 say "CI validation in `argocd/.github/workflows/validate.yml` passes" and name `kustomize build`, but no task names `yamllint` or `kubeconform`. The agent never opened `validate.yml`, and its single `pm research --repo argocd` call used search terms that did not surface it. Nothing in the plan is wrong; it is underspecified.

### The three cross-repo-order misses

In each, the 10% traffic task never reaches the webshop version change through `depends-on`. The load balancer is upstream in all three.

- p7: T06 (traffic) depends on T03 and T05, and neither reaches T01 (version endpoint). T03's acceptance criteria cite "its `/version` from T01".
- p9: T05 (traffic) depends on T03, which depends on T02 (load balancer) only. T03's Notes say "Verify the `/version` check only after T01 has shipped", and `plan.md` calls T01 a must that "nothing downstream is verifiable" without. T05 also does not wait for T04 (test hostname).
- p10: T07 (traffic) depends on T04 and T06, and neither reaches T01 or T02 (version endpoint, version in the build). T04 starts the canary on "a currently published tag". No task names T01 or T02.

In p7 and p9 the plan text knew the order and the `depends-on` edge was dropped. Only p10 shows no sign of it. So at least two of the three are a consistency slip within the plan, not missing repo knowledge.

## Grader bugs (version 1), fixed in version 2

Re-graded by hand above. Each is pinned by a test under "grader version 2" in `bench/tests/graders-multi-repo-context.test.ts`.

1. `conventions` does not read Out of scope. p2's infra task T01 says "Running `terraform apply` from a workstation: CI applies after merge per `infra/AGENTS.md`" under Out of scope, and the grader found no CI routing. False fail.
2. `conventions` reads a warning as an instruction. p5's T03 says "land this via PR; Argo CD's `selfHeal: true` reverts manual `kubectl apply`". The second clause has no negation word, so it counted as a hand apply. False fail.
3. `cross-repo-order` treats the argocd canary workload as a webshop release. In p7 (T03) and p10 (T04), the workload task names `ghcr.io/pm-example/webshop` (a webshop signal) and words like "release a candidate", so it was placed in webshop as well and counted as the release the switch depends on. False pass in p7. Version 2 drops the image name as a webshop signal, since argocd's kustomization names it too.
4. Found by re-grading with the first three fixed: in p10, T06 (a DNS task) was placed in webshop and infra by the name fallback, which matched `webshop-canary-direct`, `#webshop` and `#infra`, and "a release that needs a test hostname" made it the release. Version 2 ignores a repo name inside a hyphenated identifier or a channel. False pass in p10.

Version 2 also reads Out of scope for the CI hand-off (bug 1; an apply listed there is still never an instruction) and treats a clause about Argo CD reverting an apply as a warning (bug 2).

Re-grading the ten saved plans with version 2 gives exactly the hand verdicts: `own-checks-argocd` fails p4, `cross-repo-order` fails p7, p9 and p10, and every other check passes in every attempt.

## Other findings

- Every attempt passed several `--repo` flags to one `pm research` call at least once, and in nine the first research call did. `pm research` keeps only the last `--repo` and says nothing. `commands.md` documents one `--repo`; the CLI should refuse repeats or research each repo.
- Three planners edited the memo (p1, p2, p10). p1 wrote per-repo conventions into it on its own: commands, the CI-only apply, and "argocd rolls it out by bumping `newTag`".
- Cost was $12.95 against the $7.76 estimate: $1.30 per attempt against $0.78.
- p1 spent five calls reconciling the real date with `PM_TODAY`, and four other attempts spent one each. This is harness noise, not skill behaviour.

## Context

Per attempt, from `attempts.jsonl` telemetry. Fresh tokens are input plus cache writes. Pre-framing context is the tokens on the call that made the first `docs/pm` write, minus the first call. p6 and p7 recorded none.

| Attempt | Fresh tokens | Output tokens | Cost | Duration | Pre-framing context | Pre-framing tool chars | Turns |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| p1 | 108855 | 45332 | $1.54 | 500s | 64784 | 52098 | 49 |
| p2 | 116221 | 50840 | $1.87 | 563s | 43826 | 37103 | 66 |
| p3 | 85442 | 33993 | $0.93 | 355s | 39374 | 33510 | 38 |
| p4 | 125137 | 50625 | $1.55 | 503s | 48550 | 49940 | 67 |
| p5 | 107375 | 48430 | $1.34 | 502s | 50689 | 44793 | 50 |
| p6 | 78272 | 28046 | $0.80 | 319s | n/a | n/a | 19 |
| p7 | 102273 | 41347 | $1.38 | 485s | n/a | n/a | 34 |
| p8 | 92052 | 36399 | $1.06 | 385s | 38190 | 36660 | 47 |
| p9 | 111248 | 47375 | $1.30 | 513s | 44370 | 40174 | 35 |
| p10 | 97515 | 39322 | $1.18 | 422s | 62732 | 37568 | 50 |

Medians from `REPORT.md`: duration 492 s, cost $1.32, pre-framing context 46460 tokens (n 8), pre-framing tool output 38871 characters (n 8).

`pm status --harness claude-code` on a freshly built fixture (`PM_TODAY` 2026-09-15) prints 1743 characters: the two story claims, the three registered projects and the stripped memo. The paths in it vary with the temp directory's name length.
