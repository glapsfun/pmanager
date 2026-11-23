# cross-repo-breaks: hand audit and decision

**The question.** With `breaks:` and the rules E-BRK-001/002 in the skill, how often is the endpoint removal of `total_cents` still ordered before webshop's rollout (cold: 3 of 10), does the output scenario stay safe in 10 of 10, and at what extra median cost? #77 milestone 2, the measured slice.

**The run.**
- Ten runs each of `cross-repo-endpoint` and `cross-repo-output`, `with-skill` only, all `completed`, $27.94.
- claude-code 2.1.330 (the cold run used 2.1.327, recorded and not pinned), `claude-sonnet-5`, offline, `--timeout-s 1500`.
- `with-skill` is the skill as built on `feat/breaks-rule` at `a1353d9` (`sha256:0e1628a1...`). Grader version 2 at run time. `RUBRIC.md` was committed before the run.

**The hand audit.** Two auditors, one per scenario, read every plan and transcript against `RUBRIC.md`, without the grader's verdicts. Grader version 3 (below) agrees with them on all 40 scenario-check rows.

**Offline.** No attempt's `system/init` listed `WebFetch` or `WebSearch`, and no transcript fetched anything by hand. `pm research`'s own `gh` probe still reached GitHub (see the flags).

## Decision

The bar as written in `RUBRIC.md`, on the hand counts and `REPORT.md`'s medians:

| Condition | Bar | Result | Holds |
| :--- | :--- | :--- | :--- |
| 1. `cross-repo-endpoint`: `client-safe-rollout` fails | at most 1 of 10 | 0 of 10 (cold: 3 of 10) | yes |
| 2. `cross-repo-output`: `consumer-covered` and `switch-order` pass | 10 of 10 | 10 of 10 and 10 of 10 | yes |
| 3. Median cost, endpoint | at most $1.33 | $1.15 (cold $1.13) | yes |
| 3. Median cost, output | at most $1.24 | $1.01 (cold $1.04) | yes |

All three hold, so the slice ships. The merge is the user's call; the rest of milestone 2 stays parked.

## What the plans did

**Endpoint: 10 of 10 safe, against 3 of 10 unsafe cold.**
- 9 of 10 declared `breaks: [webshop]`, always on the orders task that removes or replaces `total_cents`. p6 declared nothing and was safe anyway.
- E-BRK fired in 3 runs, one round each:
  - **p7, right.** The first draft replaced `total_cents` in T01 with `depends-on: []`, and webshop's change and rollout came after orders. E-BRK-001: "T01 breaks webshop, and no task changes webshop before it". The agent reordered the plan, webshop first.
  - **p10, right by the rubric's order check.** T05 (replace `total_cents`) had `depends-on: []`. E-BRK-001: "T05 breaks webshop and does not wait for its rollout (T04 sets newTag in argocd/workloads/webshop)"; the fix added T04. Orders' own rollout already waited for T04, so the deployed order was safe before the fix; only the merge of the break ran ahead.
  - **p4, false.** T07 already reached webshop's rollout T06, release T05 and change T04. E-REL-001 also fired: T05's "Tag and push a `v*` release for the commit from T04" did not read as a tag push, and E-BRK, which uses the same release detection, said webshop's change had "no rollout task after its release yet". The fix only reworded T05 (`git tag v1.1.0 && git push origin v1.1.0`). This is a gap in E-REL's tag-push wording, inherited by E-BRK, not in the order check.
- So two plans were unsafe as first drafted and E-BRK moved them; the other eight were safe in their first draft.

**Output: 10 of 10 safe, as cold.**
- Every plan has one `[argocd/workloads/webshop]` task that changes `ASSETS_BUCKET`, after the create; the delete waits on it.
- 3 of 10 declared `breaks: [argocd]` on the infra delete task (p2, p7, p8), each in the first draft, and each passed `pm record` with no E-BRK finding. None declared `[webshop]`. E-BRK never fired in this scenario: no false failure.

## Grader version 2 against the hand audit

Version 2 differed from the hand audit on 2 of the 40 scenario-check rows:

1. **Endpoint p5, both checks: hand pass, v2 fail.** Not a grader bug. After `pm release`, p5 ran `git checkout main` (call 31), so the `docs-pm/` the bench captured has no epic or tasks. The plan is on branch `pm/orders-multi-currency` (`f04de16`) and, unchanged, in the bundle the transcript wrote for `pm record --from` (call 26). The auditor graded the plan from that bundle: T04 (the reshape, `breaks: [webshop]`) depends on T03 (argocd `newTag`), which depends on the webshop release T02 and change T01. Rebuilt from the bundle with `parseBundle`, the plan passes both checks under v3. Bar 1 holds either way.
2. **Output p10, `switch-order`: hand pass, v2 fail ("T01 deletes the old bucket without waiting for T03").** A grader bug. T01 creates the new bucket; a hard-wrapped bullet in it reads "(do not remove the old output yet - T05 / removes it once the old bucket is gone)" (the plan has a dash). The grader drops "T05 removes ..." as another task's removal, but it split the text at the line break first, so "removes it once the old bucket is gone" stood alone and read as a delete.

## Grader version 3

- A task id at the end of a line, followed by a line that goes on in lower case with a removal verb ("T05", then "removes it ..."), is the same sentence: another task's removal, not this task's. A new line that starts a sentence ("Coordinate with T03", then "Delete ...") is still a delete.
- Two tests from p10's wording: the wrapped reference passes, and the nearby wrong plan still fails. The first failed under v2.
- Re-grade with v3: a throwaway script laid each attempt's `docs-pm/` (p5: its rebuilt bundle) over an empty repo and ran its scenario's two checks. v3 equals the hand audit on all 40 rows. `REPORT.md` and `BENCH.md` keep the run-time v2 success rates (endpoint 90%, output 90%). With v3 the output rate is 100%; endpoint stays 90%, because p5's common checks fail on the captured state.

## Cost and time

From `REPORT.md` and each transcript's final `result` event.

| Scenario | Total | Median | Median time | Cold median |
| :--- | ---: | ---: | ---: | ---: |
| cross-repo-endpoint | $16.41 | $1.15 | 438 s | $1.13 |
| cross-repo-output | $11.52 | $1.01 | 412 s | $1.04 |

| Attempt | Endpoint cost, time | Output cost, time |
| :--- | ---: | ---: |
| p1 | $0.96, 367 s | $0.95, 406 s |
| p2 | $1.15, 391 s | $1.59, 542 s |
| p3 | $1.27, 464 s | $1.03, 415 s |
| p4 | $1.59, 561 s | $1.21, 466 s |
| p5 | $0.87, 326 s | $0.96, 379 s |
| p6 | $1.10, 437 s | $0.92, 399 s |
| p7 | $1.47, 630 s | $1.62, 561 s |
| p8 | $5.85, 1261 s | $1.32, 480 s |
| p9 | $1.00, 438 s | $0.99, 363 s |
| p10 | $1.15, 434 s | $0.92, 398 s |

- The three runs with an E-BRK round cost $1.59 (p4), $1.47 (p7) and $1.15 (p10).
- Endpoint p8's $5.85 is #61's lint detour: about 100 calls of markdownlint fixes, then a second claim, record and release. No E-BRK finding.
- Lint detours: endpoint p2, p3, p7, p8; output p2, p4, p7, p8, p9. In the output scenario they cost a median $1.32 against $0.95 for the rest.

## Flags

- **`pm research` reached GitHub offline.** Every research call ran `gh` and printed GitHub's own "Could not resolve to a Repository" reply, in all 20 attempts. Nothing came back and no plan changed, as in `cross-repo-links-cold`.
- **A run read host paths.** During its lint detour, endpoint p8 ran `find /` and read the host's `~/.bun` and `~/.nvm`.
- **A plan the bench did not capture.** Endpoint p5 switched the manager checkout back to `main` after releasing, so its captured `docs-pm/` is empty; six common checks fail on the captured state.
- **E-REL's tag-push wording.** "Tag and push a `v*` release" is not read as a tag push (endpoint p4); E-BRK inherits it.
- **Claims left held.** Endpoint p1, p3, p4, p6, p7, p10; output p1, p2, p3, p5, p6, p9 (output p4's state is unclear: its bundle rewrote `epic.md` without the `session:` block). No check covers it.
- No commits outside `docs/pm/` in any run.

## For the next step

The slice ships on the user's go-ahead: a PR for `feat/breaks-rule` and the result on #77. Follow-ups worth their own issues: E-REL's tag-push wording (one false E-BRK round here), the bench capturing a plan after the agent switches branches, and #61's lint detours, which made the dearest runs again.
