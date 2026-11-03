# memory-recall-current: rubric, written before the run

Experiment `memory-recall-current`: claude-code with claude-sonnet-5, condition with-skill, 10 runs of scenario `memory-recall` (grader version 1). The skill under test is the one at main `82be995`: the manifest's `skillHash` is `sha256:8d079e260a8f2c2cd4ba9a1aed0925649a134aea2738ad31d143d2f397243e23`, the same hash as the skill directory of a clean `82be995` checkout. Design: `.docs/specs/2026-11-03-memory-recall-bench-design.md` (local, not tracked).

## Decision rule

Copied from the design, fixed before the run:

Fixed before the run. An attempt is graded unless the harness or API failed (crash, API error); those are excluded. A timeout counts as not handled, since the larger memo may be the cause. Fewer than 8 graded attempts makes the experiment inconclusive, and topping it up is the user's call. For each of the three traps, after the hand audit:

- At most one graded attempt not handled: no build for that recall path.
- Two or more not handled: that path has a gap. Write a small design for the smallest fix aimed at the observed failure, then rerun this scenario with and without the fix. Candidates: cap or rank what `pm status` prints from the memo; require a source and date on memo lessons; keep lessons in one file each.
- Pre-framing context is reported alongside. There is no budget number to judge it against, so it has no threshold; it is the baseline a fix must not worsen.

If all three traps pass, post the results on #15 and suggest closing it, as with #13.

In the bench's attempt statuses (`bench/execute.ts`): `completed` is graded; `harness-error` and `setup-error` are excluded; `timeout` is graded and counts as not handled for every trap.

## Handled, per trap

Each is confirmed by reading the plan, not taken from the check alone.

| Trap | Recall path | Handled when |
| :--- | :--- | :--- |
| Memo lesson: Legal sign-off with a LEGAL-REVIEW ticket for customer-facing email templates (memo bullet 21 of 40) | 1, the memo printed by `pm status` | `memo-lesson-applied` passes and the plan really holds every task that sends to shoppers until the review |
| Prior-epic lesson: non-order mail goes on `stream="bulk"` (Outcome of `deals-newsletter`) | 2, the semantic pick from `pm status` rows | `prior-epic-cited` and `prior-lesson-applied` both pass and both hold up on reading |
| Superseded fact: the memo names LaunchDarkly; `flags-in-repo` and the code say `config/flags.yaml` (memo bullet 33 of 40) | whether a stale memo line misleads | `stale-not-followed` passes and the rollout really uses the in-repo flags |

## Trace to memory, per trap

A handled trap with no trace below is recorded as "handled, source unclear".

- Memo lesson: the plan names a token only the memo has: `LEGAL-REVIEW`, the 5-business-day lead time, or the memo itself as the source. A generic "legal review" with none of these is "handled, source unclear".
- Prior-epic lesson: `grep -l -E 'Gmail spam|reverted 2026-05-20' bench/experiments/memory-recall-current/artifacts/*/raw.jsonl` lists the attempt. Both phrases exist only in the `deals-newsletter` Outcome, so a hit means the agent read it; the epic.md path alone could come from a file listing. A new epic that gives `deals-newsletter` as the reason for the bulk stream also counts.
- Superseded fact: record whether the plan's source for the in-repo flags is `flags-in-repo`, the code, or unclear.

## Audit table

Filled in after the run, one row per attempt. "DBA review" is free and does not enter the decision: whether the plan applies memo bullet 2 (all schema changes need DBA review) to the new subscriptions table.

| Attempt | Status | memo-lesson-applied | prior-epic-cited | prior-lesson-applied | stale-not-followed | stale-flagged | near-miss-not-cited | new-spec-log | Handled: memo / prior / stale | Trace: memo / prior / stale | DBA review | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |

## Notes for the audit

- The stale trap is reachable through code: `config/flags.yaml` and `app/flags.py` are in the repo. "Handled" there means the stale memo line did not override code the agent could see, not that the agent recalled `flags-in-repo`.
- The memo's `_Last updated:_` is 2026-09-10, later than `flags-in-repo` (updated 2026-08-22). The memo therefore looks current, which makes the stale line more persuasive than a visibly old one.

## Re-grade procedure

If a check misjudged a plan: add a test that pins the misjudged case, fix the check under that test, bump `graderVersion` to 2 in `bench/scenarios/memory-recall.ts`, and re-grade every saved plan with a throwaway script (build the fixture, replace its `docs/pm` with `artifacts/<attemptId>/docs-pm`, run the checks through `buildCheckContext`). Record version 1 and version 2 results side by side in NOTES.md, as `bench/experiments/planning-traps-current/NOTES.md` does.

## Phase 0 size

`pm status --harness claude-code` with `PM_TODAY=2026-09-15`, measured on freshly built fixtures before the run. Tokens are characters / 4, rounded up, as `estimateTokens` in `scripts/prune.ts` does.

| Fixture | Characters | Estimated tokens |
| :--- | ---: | ---: |
| memory-recall (12 epics, 40-line memo) | 7555 | 1889 |
| webshop (1 epic) | 787 | 197 |

## Untested

- Path 3: `pm research`'s keyword probe over INDEX rows. The lesson epic's row is built to avoid it.
- `docs/sre-incidents/`.
- Isolation between unrelated repositories.
- Concurrent sessions.
- Memo merge collisions between parallel `pm/<slug>` branches.

## Follow-ups

Each is about $10 and runs only with the user's go-ahead, under a new experiment id:

- If many handled traps come back "handled, source unclear": a control on the same fixture with the three lessons removed.
- If a path fails and the cause is unclear: a run with a small memo and few epics.
