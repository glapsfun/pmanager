# dangling-task-paired-v4: hand audit and decision

Twenty runs of `multi-repo-context` (the cold scenario), all `completed`, $21.06: ten `with-skill` (the skill with `E-REF-005`, repo `e7aefcb`, `sha256:81a7f50c...`) and ten `baseline-skill` (main at `8e9723e`, `sha256:e25d9b2a...`, the skill the cold and as-is runs used), same day, claude-code and claude-sonnet-5, grader version 4. `RUBRIC.md` was committed before the run. Every plan was read by hand; the hand verdicts equal the grader's on all seven checks in all twenty attempts.

## Decision

| Check | Rule arm | Baseline arm |
| :--- | ---: | ---: |
| own-checks-webshop | 2 (p1, p9) | 0 |
| own-checks-infra | 0 | 1 (p1) |
| own-checks-argocd | 3 (p4, p6, p9) | 1 (p10) |
| no-manager-commands | 0 | 0 |
| conventions | 1 (p6) | 1 (p1) |
| cross-repo-order | 2 (p7, p10) | 2 (p3, p4) |
| repos-registered | 0 | 0 |

The decision rule, applied as written: the baseline arm failed `cross-repo-order` twice, so the run is not inconclusive; the rule arm also failed twice, so the fixes were read. Every fix added an edge; none moved a task to another milestone. By the rule's last clause, the rule is dropped.

That clause counts every `cross-repo-order` failure, and the evidence says the rule did what it was built to do while the two rule-arm failures are shapes it cannot see:

- `E-REF-005` fired in five of ten rule-arm runs (p1, p3, p4, p5, p7). Each time it named the version task (the endpoint, or the version injected at build), and each time the planner added that task to the canary workload's `depends-on` and recorded again, so the traffic switch then waited for the version change. Without the rule those five first drafts had the version task depended on by nothing, which is the failure shape of cold p7, p9, p10 and as-is p8.
- Rule-arm p7 fails because the switch (T07) does not wait for the load balancer (T04); the version change is upstream. p10 fails because the version task's only dependent is a verification task (T04), not the switch (T05), which is as-is p4's shape. Neither fires the rule.
- Both baseline failures are the rule's shape: in p3 and p4 the release half of the version work (T02) is depended on by nothing, and the rule fires on both final plans offline.

So the rule fixed every case it caught, and the run's totals do not show it, because the arm's other failures come from shapes outside its reach and ten runs per arm carry noise of that size.

**Outcome: the rule ships** (user's decision, 2026-11-05), overriding the decision clause as written. Why: the clause counted every `cross-repo-order` failure, while the rule targets one shape; it fired in five runs and fixed that shape in all five; it costs nothing on plans it does not fire on and a median $0.06 per run overall. The two shapes it misses (a switch that skips the load balancer, and a version task whose only dependent is not the switch) stay open.

## Per attempt

| Attempt | Fails (by hand) | `E-REF-005` |
| :--- | :--- | :--- |
| rule p1 | own-checks-webshop | fired on T01 (M1); planner added T01 to T04's `depends-on` (Read, Edit, record: 3 calls) |
| rule p2 | none | did not fire |
| rule p3 | none | fired on T02 (M1); added T02 to T04 (3 calls) |
| rule p4 | own-checks-argocd | fired on T01 (M1); added T01 to T03 (5 calls) |
| rule p5 | none | fired on T01 (M1); added T01 to T03 in its bundle (5 calls) |
| rule p6 | own-checks-argocd, conventions | did not fire |
| rule p7 | cross-repo-order (switch skips the load balancer) | fired on T02 (M1); added T02 to T03 with a new bundle (1 call) |
| rule p8 | none | did not fire |
| rule p9 | own-checks-webshop, own-checks-argocd | did not fire |
| rule p10 | cross-repo-order (version task's only dependent is a verification task) | did not fire |
| base p1 | own-checks-infra, conventions | would not fire |
| base p2 | none | would not fire |
| base p3 | cross-repo-order (T02 depended on by nothing) | would fire on T02 |
| base p4 | cross-repo-order (T02 depended on by nothing) | would fire on T02 |
| base p5..p8 | none | would not fire |
| base p9 | none | would fire on T01 ("Capture a baseline 5xx rate", an M1 side task: a false flag) |
| base p10 | own-checks-argocd | would not fire |

Every rule-arm plan as finally recorded is clean under `E-REF-005`. Across both arms the rule's first-draft hit rate was five of ten with the rule and three of ten on the baseline's final plans (one of them a false flag).

## The other misses

- own-checks-argocd (rule p4, p6, p9; base p10): p4, p6 and p9 never saw `yamllint` or `kubeconform` (argocd's checks live only in `validate.yml`), like cold p4; base p10 saw them through `pm research` and did not name them. The rule fired in p4 only.
- own-checks-webshop (rule p1, p9): both read webshop's README and named no `make test`, `make lint` or `go test` in a webshop task or the plan. The rule fired in p1 only.
- own-checks-infra and conventions (base p1): never read infra's `AGENTS.md`; T04 says to check the annotation "before applying" and has `terraform plan` in envs/prod as a criterion.
- conventions (rule p6): read `AGENTS.md`, names a PR and its merge, but no task routes plan or apply through CI.

The rule arm's own-check misses (five, against two) are not tied to the rule: it fired in two of the four runs with them. Pooling the skill without the rule, cold and baseline together miss argocd's checks in 2 of 20 runs.

## Contract miss outside the seven checks

Rule p7 committed its plan, then ran the manager's `bun run lint`, `bun test` and `bun install` (the memo's convention for the manager repo), which left `bun.lock` behind: `scoped-diff` and `committed` fail. It ran them after the clean record, so the rule's error did not call for them.

## Cost

| Attempt | Fresh tokens | Output tokens | Cost | Duration | Pre-framing context | Turns |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| rule p1 | 88895 | 38422 | $1.14 | 430s | 62670 | 57 |
| rule p2 | 84962 | 36225 | $1.20 | 437s | 51002 | 58 |
| rule p3 | 78817 | 34726 | $0.97 | 408s | 58808 | 24 |
| rule p4 | 74960 | 30395 | $0.95 | 357s | 45344 | 36 |
| rule p5 | 85941 | 38785 | $1.17 | 440s | 51857 | 53 |
| rule p6 | 75790 | 36333 | $0.88 | 403s | 38865 | 35 |
| rule p7 | 98867 | 46109 | $1.41 | 515s | 36014 | 52 |
| rule p8 | 82880 | 33710 | $0.94 | 374s | 57246 | 34 |
| rule p9 | 77521 | 34689 | $0.85 | 368s | n/a | 40 |
| rule p10 | 91154 | 46366 | $1.16 | 492s | 37771 | 41 |
| base p1 | 89283 | 38896 | $1.18 | 449s | 70711 | 55 |
| base p2 | 82413 | 35569 | $1.08 | 417s | n/a | 44 |
| base p3 | 87562 | 42458 | $1.03 | 421s | 42751 | 52 |
| base p4 | 73165 | 33749 | $0.79 | 367s | 45296 | 22 |
| base p5 | 70002 | 28058 | $0.88 | 332s | 36691 | 42 |
| base p6 | 79288 | 36297 | $0.93 | 409s | 45966 | 50 |
| base p7 | 81975 | 37830 | $1.17 | 441s | 45421 | 52 |
| base p8 | 79989 | 36642 | $0.95 | 422s | 48985 | 32 |
| base p9 | 96422 | 42225 | $1.41 | 502s | 45879 | 57 |
| base p10 | 81982 | 40213 | $0.96 | 417s | 51596 | 30 |

Medians (REPORT.md): cost $1.05 with the rule against $1.00, duration 419 s in both, paired cost difference +$0.06, paired duration difference -8 s. Runs where the rule fired cost a median $1.14 against $0.94 where it did not; a fix took one to five tool calls.

## Notes for a next step

- The two rule-arm failures point at a broader shape than the first milestone: the traffic switch must wait for both the version change and the direct-access path. A rule that checks the switch task directly would need to know which task is the switch, which `pm` does not.
- `pm research` still keeps only the last `--repo` (#53).
