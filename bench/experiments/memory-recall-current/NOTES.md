# memory-recall-current: re-grade, hand audit and decision

Ten runs of `memory-recall`, all `completed`: claude-code 2.1.317, claude-sonnet-5, skill 0.10.1 (`sha256:8d079e26...`, the skill at main `82be995`), repo `9a94721`. `attempts.jsonl` and `REPORT.md` hold grader version 1, as run. The rubric (`RUBRIC.md`) was committed before the run; its audit table now holds the hand audit, which an independent auditor wrote by reading every plan without editing anything.

## Checks: version 1 as run, version 2 re-graded

Only `memo-lesson-applied` disagreed with the reading. Version 2 fixes what the audit found, each case pinned by a test in `bench/tests/graders-memory-recall.test.ts`:

- a Legal Dependencies row whose Status cell says "not filed", "not started" or "not filed yet" was read as waived; v2 treats those as pending;
- a task that adds or gates "the rollout flag" at 0% counted as a rollout; v2 reads "rollout flag" as the flag's name;
- spike and admin titles that name shopper email or subscribers ("Confirm how shopper emails are stored today", "Show notify-me subscriber counts in the admin panel") counted as sends; v2 needs a send verb before the audience or the mail;
- "legal sign-off (T05)" under Out of scope made a task a Legal task; v2 ignores Out of scope;
- real ramps were missed ("Enable restock_notify at 10%", "Turn the flag on for a small percentage"); v2 counts them;
- a send task with no edge to Legal failed even when the flag starts dark and every ramp waits for Legal; v2 passes that shape.

Re-grading the ten saved plans (`artifacts/*/docs-pm`) with version 2:

| Check | v1 passed | v2 passed |
| :--- | ---: | ---: |
| memo-lesson-applied | 5/10 | 10/10 |
| prior-epic-cited | 10/10 | 10/10 |
| prior-lesson-applied | 10/10 | 10/10 |
| stale-not-followed | 10/10 | 10/10 |
| stale-flagged (diagnostic) | 10/10 | 10/10 |
| near-miss-not-cited (diagnostic) | 10/10 | 10/10 |
| new-spec-log | 10/10 | 10/10 |
| committed (not a recall check) | 9/10 | 9/10 |

`memo-lesson-applied` per attempt:

| Attempt | v1 | v2 | v2 evidence | Reading |
| :--- | :--- | :--- | :--- | :--- |
| p1 | fail | pass | Dependencies row, Status "not filed" | handled |
| p2 | fail | pass | Dependencies row, Status "not started" | handled (borderline) |
| p3 | fail | pass | T02 flagged at 0%; ramps T05 and T06 wait for Legal (T04) | handled (borderline) |
| p4 | fail | pass | Dependencies row, Status "not filed yet" | handled (borderline) |
| p5 | pass | pass | T04 and T05 wait for Legal (T03) | not handled (borderline) |
| p6 | pass | pass | T05, T06 and T07 wait for Legal (T04) | handled |
| p7 | pass | pass | Dependencies row | handled (borderline) |
| p8 | pass | pass | Dependencies row | handled (borderline) |
| p9 | pass | pass | T09 and T10 wait for Legal (T06) | handled |
| p10 | fail | pass | Dependencies row, Status "not started" | handled (borderline) |

One disagreement remains after v2: p5 passes the check, and the reading records it as not handled. The decision follows the reading.

## The reading and its borderlines

Handled, for the memo lesson, means no restock email reaches a real shopper before Legal sign-off, and the plan records that gate as a task, a `depends-on` edge or a Dependencies row on the step that first exposes shoppers to the mail. That follows the rubric's wording: every task that sends mail to shoppers or rolls the feature out waits for a Legal review.

- p2, p4, p10: the send task has no edge to Legal; shopper sends are gated by the flag, and the ramp waits for Legal.
- p3: the send T03 runs in staging only and does not roll out; the first shopper exposure, T05 at 10%, waits for Legal (T04). p3 has no Dependencies section. Counted as handled.
- p4: the Legal task T05 can close with sign-off marked `**unverified**`, so the edge from the ramp T06 alone does not enforce sign-off; the plan text and the Dependencies row do.
- p5: T02 has `depends-on: []` and may open signup to "an initial small rollout_percent" before Legal, with no Dependencies row, although no mail goes out before Legal. Recorded conservatively as not handled (borderline).
- p7 (T03 at 10%) and p8 (T03 at 5%) open signup to a small share before Legal; no mail goes out before it, and both have a Legal Dependencies row.
- p10: milestone M2's 10% exit criterion contradicts its tasks T03 and T06, which wait for Legal.

How the memo count moves:

| Reading | Not handled | Verdict |
| :--- | ---: | :--- |
| The rubric's reading, p5 counted conservatively (used for the decision) | 1 (p5) | no build |
| The same, p5 counted as handled | 0 | no build |
| A send task must itself wait by an edge, or the plan has a Legal Dependencies row | 1 (p3) | no build |
| The same, plus signup exposure counted as rolling the feature out | 2 (p3, p5) | gap |
| No credit for Dependencies rows | 7 (p2, p3, p4, p5, p7, p8, p10) | gap |

## Per-trap counts and decision

| Trap | Graded | Not handled | Handled, source unclear | Verdict |
| :--- | ---: | ---: | ---: | :--- |
| Memo lesson | 10 | 1 (p5, borderline) | 0 | no build |
| Prior-epic lesson | 10 | 0 | 0 | no build |
| Superseded fact | 10 | 0 | exempt | no build |

- Memo lesson: every plan names `LEGAL-REVIEW`; the Legal line first reached every run through `pm status` output.
- Prior-epic lesson: the rubric's grep for "Gmail spam" or "reverted 2026-05-20" lists all 10 attempts; each hit comes from the agent reading `docs/pm/deals-newsletter/epic.md`.
- Superseded fact: every plan sources the in-repo flags to `flags-in-repo` and the code, and no line builds on LaunchDarkly.

Under the decision rule all three traps are "no build". The rule's next step is to post the results on #15 and suggest closing it. This holds for one model (claude-sonnet-5) on one harness, at 12 epics and a 40-line memo.

## Cost and size

- Spend: $10.39 for 10 runs, $1.07 median per run (lowest $0.87, highest $1.27); duration median 398s; steps median 24.
- Phase 0: `pm status` prints 7,613 characters (about 1,904 tokens) on this fixture, against 787 (about 197) on webshop.
- Pre-framing context: median 52,648 tokens (IQR 48,572 to 54,984; n 10). Tool output before the first `docs/pm` write: median 55,497 characters (n 10). No threshold: this is the baseline a later fix must not worsen.

## Side findings, not recall gaps

- p5 corrected the memo after `pm record` committed the epic and left that edit uncommitted, so `committed` fails for p5 and its `stale-flagged` pass rests on the uncommitted edit.
- p5 and p8 skip the DBA review the memo requires for schema changes (memo bullet 2); p8's T02 changes `products` without it.
- p4's Legal task T05 can close with sign-off marked `**unverified**`.
- p10's milestone text contradicts its tasks (M2 at 10% before M3's Legal sign-off).
- All 10 corrected the stale LaunchDarkly memo line, sourced `[flags-in-repo, 2026-08-22]`.
- All 10 cited the near miss `restock-forecast` alongside `deals-newsletter`.

## Untested

- Recall path 3, `pm research`'s keyword probe over INDEX rows, and `docs/sre-incidents/`.
- Isolation between unrelated repositories.
- Concurrent sessions.
- Memo merge collisions between parallel `pm/<slug>` branches.
