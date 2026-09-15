# Tracking (update mode)

Runs when Phase 0 routes the request to **update**: task status changes,
new/changed/descoped tasks, plan revisions, or an epic approval on an
existing epic. Skip Phases 1–5; keep every change traceable.

## Resolve the target

Match the user's wording against `docs/pm/INDEX.md` (semantically — "the
performance work" matches `app-performance`). Ambiguous → ask which epic.
Then read that epic's plan.md and the affected task files before changing
anything — the docs on disk are the state of record, not your memory of
them, and the user may have hand-edited them since the last run.

## Apply the update

**Epic approval** ("the epic looks good", "approved" — consumes the
draft-awaiting-approval state a non-interactive run leaves behind):

1. If the approval came with corrections, revise the epic framing first.
2. Epic frontmatter: `status: draft → approved`, refresh `updated`; resolve
   any Open questions the user just answered.
3. Add a plan changelog row (`epic approved`) and run `pm render` (the
   INDEX row follows the frontmatter).
   When work starts on the first task, the same flow moves
   `approved → in-progress`.

**Task status** (`T02 is done`, `T03 is blocked on infra`):

1. Task frontmatter: `status`, `updated`; blockers also get a Notes line
   naming the blocker.
2. Run `pm render` (regenerates the plan task table and INDEX).
3. `done` claims: if acceptance criteria are checkable from the repo (file
   exists, test present), verify and check them off; if not, ask or mark
   them explicitly unverified — never silently check boxes. An unverifiable
   done claim gets the line `**unverified** — <why>` under Acceptance
   criteria so `pm check` accepts it.

**Scope changes** (add/split/descope tasks, shift a milestone):

1. Create/edit task files per `task.template.md` (INVEST still applies —
   an update is not an excuse for an untestable task).
2. Update the plan's MoSCoW section and add one changelog row
   (`date | change | why`); the task table is rendered. Descoped work moves
   to the `- Won't (this epic):` line with its reason (E-ST-002) and the
   task file's frontmatter is set to `status: descoped` — a recorded
   decision, not a deletion; descoped tasks are excluded from INDEX task
   counts and next-task ranking.
3. A change that breaks the epic's framing (new scope contradicts
   non-goals, metric no longer fits) → stop and say so: that's a new epic
   or an epic revision needing approval, not a quiet plan edit.

**Progress effects:**

- Last Must task done → remind the user the validation plan is now due
  (verification ≠ validation — the metric still has to be measured).
- All milestones' exit criteria met and validation measured → offer to set
  the epic `done`, recording the outcome (did the hypothesis hold?) in the
  epic — that outcome line is what future recalls learn from.

## Claim management and handoff

"release the X epic" → `pm release <slug>`. "take over X" →
`pm claim <slug> --takeover` only when `pm status` shows `[stale]`;
otherwise tell the user the owner must release. "pick up T03 of X" /
"brief for T03" → `pm handoff <slug> T03`, print it verbatim, write
nothing. All three end with a one-line confirmation.

## Write-back (every update run)

Run log entry (`kind: update`), memo hand-written sections if something
durable was learned, `pm render`, `pm check` to exit 0, then the scoped
commit and push of `pm/<slug>` per `memory.md` (the single source for the
command and its rules). Post a compact status after: the `pm status` line
for the epic, tasks by status, current blockers, suggested next task
(respecting `depends-on` and priority).
