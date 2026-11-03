# memory-recall-current: rubric, written before the run

Experiment `memory-recall-current`: claude-code with claude-sonnet-5, condition with-skill, 10 runs of scenario `memory-recall` (grader version 1). The skill under test is the one at main `82be995`: the manifest's `skillHash` is `sha256:8d079e260a8f2c2cd4ba9a1aed0925649a134aea2738ad31d143d2f397243e23`, the same hash as the skill directory of a clean `82be995` checkout. Design: `.docs/specs/2026-11-03-memory-recall-bench-design.md` (local, not tracked).

## Decision rule

Copied from the design, fixed before the run:

Fixed before the run. An attempt is graded unless the harness or API failed (crash, API error); those are excluded. A timeout counts as not handled, since the larger memo may be the cause. Fewer than 8 graded attempts makes the experiment inconclusive, and topping it up is the user's call. For each of the three traps, after the hand audit:

- At most one graded attempt not handled: no build for that recall path.
- Two or more not handled: that path has a gap. Write a small design for the smallest fix aimed at the observed failure, then rerun this scenario with and without the fix. Candidates: cap or rank what `pm status` prints from the memo; require a source and date on memo lessons; keep lessons in one file each.
- Pre-framing context is reported alongside. There is no budget number to judge it against, so it has no threshold; it is the baseline a fix must not worsen.

If all three traps pass, post the results on #15 and suggest closing it, as with #13.

Added before the run, at the user's request on 2026-11-03: when the rule above gives the memo lesson or the prior-epic lesson "no build", but 3 or more of its graded attempts are "handled, source unclear" (see Trace to memory below), that trap is inconclusive instead, and the next step is the control run from the design: the same fixture with the three lessons removed, still only with the user's go-ahead. The superseded fact is exempt, because there "handled" means the stale line did not mislead, whatever the source.

In the bench's attempt statuses (`bench/execute.ts`): `completed` is graded; `harness-error` and `setup-error` are excluded; `timeout` is graded and counts as not handled for every trap.

## Reporting a mixed outcome

When one trap is inconclusive (fewer than 8 graded attempts, or the "handled, source unclear" paragraph above) and the other traps are "no build": report the inconclusive trap as inconclusive, propose the control run for it (still the user's call), and post the results on #15 without suggesting that #15 be closed. Closing is suggested only when every trap is "no build".

## Reading is the authority

The auditor reads every plan, passing or failing, and fills the Handled column from that reading. The checks are a first pass. When a check and the reading disagree on any attempt, the re-grade procedure below runs before the decision. The decision rule counts the Handled column, not the check results.

## Handled, per trap

| Trap | Recall path | Handled when, on reading | Check expected to agree |
| :--- | :--- | :--- | :--- |
| Memo lesson: Legal sign-off with a LEGAL-REVIEW ticket for customer-facing email templates (memo bullet 21 of 40) | 1, the memo printed by `pm status` | every task that sends mail to shoppers or rolls the feature out waits for a Legal review: a task, a `depends-on` edge, or a Dependencies row | `memo-lesson-applied` |
| Prior-epic lesson: non-order mail goes on `stream="bulk"` (Outcome of `deals-newsletter`) | 2, the semantic pick from `pm status` rows | the new epic cites `deals-newsletter` under Related prior work, and the plan sends the restock mail on the bulk stream, with nothing sending it on the transactional stream | `prior-epic-cited` and `prior-lesson-applied` |
| Superseded fact: the memo names LaunchDarkly; `flags-in-repo` and the code say `config/flags.yaml` (memo bullet 33 of 40) | whether a stale memo line misleads | the rollout uses the in-repo flags, and nothing builds on LaunchDarkly | `stale-not-followed` |

## Trace to memory, per trap

A handled trap with no trace below is recorded as "handled, source unclear".

- Memo lesson: the plan contains one of exactly these tokens: `LEGAL-REVIEW`; the lead time written as 5 business or working days, in digits or words; the phrase "consent and unsubscribe wording", which in this fixture exists only in memo bullet 21; or a citation of `pmanager-memo.md` or "the memo" as the source of the review. "A week", or a generic "legal review" with none of these, is "handled, source unclear".
- Prior-epic lesson: `grep -l -E 'Gmail spam|reverted 2026-05-20' bench/experiments/memory-recall-current/artifacts/*/raw.jsonl` lists the attempt. Both phrases exist only in the `deals-newsletter` Outcome, so a hit means the agent read it; the epic.md path alone could come from a file listing. A new epic that gives `deals-newsletter` as the reason for the bulk stream also counts.
- Superseded fact: record whether the plan's source for the in-repo flags is `flags-in-repo`, the code, or unclear.

## Audit table

Filled in after the run, one row per attempt. "DBA review" is free and does not enter the decision: whether the plan applies memo bullet 2 (all schema changes need DBA review) to the new subscriptions table.

| Attempt | Status | memo-lesson-applied | prior-epic-cited | prior-lesson-applied | stale-not-followed | stale-flagged | near-miss-not-cited | new-spec-log | Handled: memo / prior / stale | Trace: memo / prior / stale | DBA review | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| p1 | completed | fail | pass | pass | pass | pass | pass | pass | yes / yes / yes | LEGAL-REVIEW, 5 business days, memo cited / grep hit, cites deals-newsletter as the bulk reason / flags-in-repo + code | yes (T02) | Check misread T03 (adds the flag at 0%) as a rollout and missed the Legal Dependencies row (its Status cell says "not filed"). The send T05 and the ramp T08 depend on T06 (Legal). |
| p2 | completed | fail | pass | pass | pass | pass (memo corrected) | pass | pass | yes (borderline) / yes / yes | LEGAL-REVIEW, 5 business days, memo cited / grep hit, reason given / flags-in-repo + code | yes (T01, not in acceptance) | Check misread T05 (flag at 0%) as a rollout. T06 builds the send on placeholder copy with no edge to T02. The ramp T09 depends on T02 and needs Legal-approved copy before going above 0%. Dependencies row missed ("not started"). |
| p3 | completed | fail | pass | pass | pass | pass | pass | pass | yes (borderline) / yes / yes | LEGAL-REVIEW, 5 business days, memo cited / grep hit, reason given / flags-in-repo + code | yes (T01) | T03 sends in staging only and has no edge to T04 (Legal). The first shopper send is T05 at 10%, which depends on T04. No Dependencies section. |
| p4 | completed | fail | pass | pass | pass | pass | pass | pass | yes (borderline) / yes / yes | LEGAL-REVIEW, 5 business days, memo cited / grep hit, reason given / flags-in-repo + code | yes (T02) | Check treated T01 (a spike) and T09 (an admin count view) as sends. T04's send job has no edge to T05 (Legal), and T05 can close with sign-off marked `**unverified**`. The 5% ramp T06 depends on T05. Dependencies row missed ("not filed yet"). |
| p5 | completed | pass | pass | pass | pass | pass (memo corrected, uncommitted) | pass | pass | not handled (borderline) / yes / yes | LEGAL-REVIEW, 5-business-day, "consent and unsubscribe wording", memo cited / grep hit, reason given / code + flags-in-repo plan.md | no | `committed` failed: the memo correction was left uncommitted. T02 (`depends-on: []`) may open signup to "an initial small rollout_percent" before Legal. The send T04 and the ramp T05 wait on T03 (Legal). |
| p6 | completed | pass | pass | pass | pass | pass | pass | pass | yes / yes / yes | LEGAL-REVIEW, 5 business days, memo cited / grep hit, reason given / flags-in-repo + code | yes (T01) | Clean: the send T05 and the ramps T06/T07 all reach T04 (Legal). |
| p7 | completed | pass | pass | pass | pass | pass | pass | pass | yes (borderline) / yes / yes | LEGAL-REVIEW, 5 business days, "consent and unsubscribe wording" / grep hit, reason given / flags-in-repo + code | yes (T02) | Check passed on the Dependencies row. T03 opens signup to 10% before Legal. The send T05 depends on T01 (Legal). |
| p8 | completed | pass | pass | pass | pass | pass | pass | pass | yes (borderline) / yes / yes | LEGAL-REVIEW, 5 business days, memo cited / grep hit, reason given / flags-in-repo + code | no | T03 runs a 5% signup canary before Legal. The send T05 depends on T01 (Legal). T02 changes `products` with no DBA review. |
| p9 | completed | pass | pass | pass | pass | pass | pass | pass | yes / yes / yes | LEGAL-REVIEW, 5-business-day, "consent and unsubscribe wording" / grep hit, reason given / flags-in-repo + code | yes (T02) | Clean: the send call is in T06 (Legal). The flag T07 depends on T06, and the ramps T09/T10 follow T07. |
| p10 | completed | fail | pass | pass | pass | pass | pass | pass | yes (borderline) / yes / yes | LEGAL-REVIEW, 5 business days, "consent and unsubscribe wording", memo cited / grep hit, reason given / flags-in-repo + code | yes (T02) | Check treated T01 (a spike) and T03 (flag at 0%) as sends. T04's send has no edge to T05, but T05 hard-gates production sends. Milestone M2 says 10% before M3's Legal sign-off, which contradicts the tasks. Dependencies row missed ("not started"). |

## Notes for the audit

- The stale trap is reachable through code: `config/flags.yaml` and `app/flags.py` are in the repo. "Handled" there means the stale memo line did not override code the agent could see, not that the agent recalled `flags-in-repo`.
- The memo's `_Last updated:_` is 2026-09-10, later than `flags-in-repo` (updated 2026-08-22). The memo therefore looks current, which makes the stale line more persuasive than a visibly old one.
- The memo's Legal rule is dated 2026-06-02, after `deals-newsletter` finished (2026-05-28), so no done epic shipped customer-facing email after the rule without Legal. No epic mentions Legal; the lesson lives only in the memo (bullet 21 and a Stakeholders row).
- `near-miss-not-cited` fails only when `restock-forecast` is cited in place of `deals-newsletter`. The design said it passes when the near miss is not cited at all; citing both is a sound reading of two related epics, so it is not counted as a miss. This is a deviation from the design.
- The run sets no `CLAUDE_CODE_MAX_BUDGET_USD`: it is unset in the shell that starts the experiment, so no per-run budget cap applies.
- Wordings that still fail a check's positive signal by design, so the reading decides them:
  - the bulk stream named only in plan.md (for example the Approach), not in any task line: `prior-lesson-applied` fails;
  - the in-repo flags named only in plan.md, not in any task line: `stale-not-followed` fails;
  - a Legal review named only in the Risk register or Approach, not as a task, a `depends-on` edge or a Dependencies row: `memo-lesson-applied` fails;
  - a Legal review named without "review", "sign-off" or "approval" (for example "Legal: consent wording"): not counted;
  - a send task whose title names no send, email or notify with an audience, no send of mail and no rollout, and whose body has no `mailer.send`, `send(` or `stream=`: not seen as a send;
  - `deals-newsletter` cited only outside Related prior work: `prior-epic-cited` fails;
  - the bulk stream called by another name ("news stream", "marketing stream"): not counted.

## Re-grade procedure

If a check misjudged a plan: add a test that pins the misjudged case, fix the check under that test, bump `graderVersion` to 2 in `bench/scenarios/memory-recall.ts`, and re-grade every saved plan with a throwaway script (build the fixture, replace its `docs/pm` with `artifacts/<attemptId>/docs-pm`, run the checks through `buildCheckContext`). Record version 1 and version 2 results side by side in NOTES.md, as `bench/experiments/planning-traps-current/NOTES.md` does.

## Phase 0 size

`pm status --harness claude-code` with `PM_TODAY=2026-09-15`, measured on freshly built fixtures before the run. Tokens are characters / 4, rounded up, as `estimateTokens` in `scripts/prune.ts` does.

| Fixture | Characters | Estimated tokens |
| :--- | ---: | ---: |
| memory-recall (12 epics, 40-line memo) | 7613 | 1904 |
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
