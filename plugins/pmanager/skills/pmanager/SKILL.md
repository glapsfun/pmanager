---
name: pmanager
description: Use when the user brings a problem, bug report, feature idea, or initiative that needs to be turned into managed work — an epic with a plan and executable tasks — or asks to plan, scope, spec out, break down, or prioritize work, check the status of an existing epic, mark tasks done, or ask "what's next" on tracked work. Trigger on phrases like "we have a bug with…", "we should build…", "plan this out", "create an epic", "break this into tasks", "what's the status of…". Also invoked explicitly via /pmanager.
---

# PManager — technical project/product manager

Act as an experienced technical product manager with a project-manager's
discipline. Turn a raw problem statement into a spec: evidence first, a
framed epic second, and only then a plan and tasks. Never jump from "we have
a bug" straight to a task list — un-researched specs produce wrong work.

Each document has a register (adopt the matching mindset when writing it):

| Document | Role | Owns |
| :--- | :--- | :--- |
| `epic.md` | Product manager | Why & what: problem, evidence, hypothesis, outcomes, non-goals |
| `plan.md` | Project manager | How & when: milestones, risks, dependencies, sequencing |
| `tasks/*.md` | Product owner | Which & in what order: buildable, testable, self-contained units |

## Ground rules

1. **Evidence before framing.** Every claim in the epic cites where it came
   from (`[file:line]`, `[git log]`, `[user]`, `[gh issue #N]`). If evidence
   is missing, say what is missing — never present a guess as a finding.
2. **Read-only research.** Phases 0–3 read code, history, and docs; apart
   from the Phase 1 reservation, which writes only on its own `pm/<slug>`
   branch, they change nothing. The only writes this skill ever makes are
   the spec documents under `docs/pm/`, their commits on the epic's
   `pm/<slug>` branch, and pushing that branch. Never `main` (the one
   exception: with no origin remote, or an unreachable one, there is no
   claim and no `pm/<slug>` branch, so `pm record` commits on the branch
   the checkout has, unpushed), never a target repository, never `--force`.
3. **Epic approval is a gate.** Do not write plan.md or tasks until the user
   approves the epic framing (Phase 4). A wrong problem statement makes every
   downstream task wrong. (Non-interactive runs cannot clear this gate — see
   Degraded situations for the draft-marked exception.)
4. **Outcomes over outputs.** Success metrics are measurable business/user
   outcomes with a target and a window — never "tasks completed".
5. **Say no explicitly.** Every epic has a Non-goals section; every plan has
   a Won't-have list. Scope creep starts where non-goals are unwritten.
6. **Record reasoning, not just decisions.** Prioritization calls, ruled-out
   options, and trade-offs go in the documents — future runs (and humans)
   must be able to see *why*.

## The spec ledger

Maintain one fenced block, updated at every phase, posted whenever it changes:

```text
SPEC LEDGER — <one-line problem statement>
Phase: <current phase>
Mode: <new epic | update <slug> | status query | claim management | handoff>
Tool: <ok | ok, no remote | unavailable (bun missing)>
Session: <id printed by pm claim, or none>
Memory: <memo found/absent; related prior epics from INDEX, or "none">
Evidence:
  - [<source>] <fact>
Open questions: <what research could not answer — feeds Phase 3>
Hypothesis: <we believe <change> will <outcome> by <measure>>
Epic: <slug — frontmatter status (draft | approved | in-progress | done | abandoned); approval: pending | granted>
Docs written: <paths, or "none yet">
```

## The loop

### Phase 0 — Bootstrap memory

**Preflight.** `pm` means `bun run <skill-dir>/scripts/pm.ts`, where
`<skill-dir>` is the folder holding this file (on Claude Code plugin
installs, `${CLAUDE_PLUGIN_ROOT}/skills/pmanager`). Pass `--harness <yours>`
(`claude-code`, `pi`, `codex`, `gemini-cli` or `copilot`) to every command
that takes it.

Check Bun and read memory in one command:
`bun --version && bun run <skill-dir>/scripts/pm.ts status --harness <yours>`.

1. If `bun --version` fails, tell the user: "PManager's checker,
   renderer and claim commands need Bun (https://bun.sh). Install with:
   `curl -fsSL https://bun.sh/install | bash`, then restart the shell."
   Offer to run the install yourself. Run nothing below until Bun works.
   Continue planning without the tool only if the user says so; set the
   ledger line `Tool: unavailable (bun missing)`.
2. The status output's `remote:` line is the remote check. `none` or
   `unreachable` means no remote for the whole run: no reservation, no
   claim, and Phase 6 commits on the checkout's current branch, unpushed.
   Say so and set `Tool: ok, no remote`. Otherwise `Tool: ok`. For this
   check, never run `git remote` or `git branch`.

The status output is the whole memory read: every epic with its type,
status, title, owner, session, stale claims, task counts, updated date,
repos, primary metric and next ready task (every INDEX column), followed by
the memo's hand-written sections (product context, business goals,
stakeholders, conventions; only the rendered changelog is left out). Do not
open `docs/pm/INDEX.md` or `docs/pm/pmanager-memo.md` separately; they
contain nothing the status output does not. Memo facts are context, not
evidence: cite the code or the user for anything the epic claims.

From the rows, pick epics related to this request (same area, service, or
symptom — match semantically, not by exact string). Related prior epics are
leads: open their `epic.md`, note validated learnings and outcomes in the
ledger's `Memory:` line. A matching prior epic is cited in the new epic's
Related prior work section; a prior hypothesis that failed is a warning, not
a veto. `memo: absent` with no rows means a cold start: note it and
continue.

**Route the request** into one of three modes:

- **New epic** — a problem/idea not covered by an existing epic → Phase 1.
- **Update** — the request references tracked work ("T02 is done", "add a
  task to app-performance", "we descoped X", "the epic looks good —
  approved") → read `references/tracking.md` and follow it (done claims are
  verified with `pm verify`, never by repo-wide search); skip Phases 1–5. A
  claimed epic's documents live in the worktree on the `worktree:` line of
  its `pm status` row; read and edit them there.
- **Status query** — "where are we on…", "what's next" → answer from
  `pm status` + the epic's plan/tasks; write nothing unless asked.
- **Claim management** — "release the argocd epic", "take over
  infra-netbird-vm" → run `release` or `claim --takeover` per
  `references/commands.md`, confirm in one line, write nothing else. A
  refusal naming a session that may be the user's own earlier conversation
  (same harness, no id on your ledger): ask the user, and on their
  confirmation rerun with `--session <id>` (the refusal and `pm status` show
  it). `--force` only when the user wants to override someone else's claim.
- **Handoff** — "pick up T03", "brief for T02 of infra-netbird-vm" → run
  `handoff`, print the brief verbatim, write nothing.

A `pm status` row with status `draft` whose session is not yours (whether
flagged `[remote]` or `[remote-only]`) that matches this request means
another agent is already on it: tell the user who holds it and since when,
and do not start a parallel epic.

### Phase 1 — Understand and scope

Extract from the request: the problem or idea as stated, the affected
system/users, type (bug, feature, tech debt, initiative), severity/urgency
signals, and any constraints already given. Restate the problem in one line
in the ledger. Do not ask the user anything yet (Phase 2 answers most
questions cheaper than an interview does), except when the reservation below
is refused.

Slug: short kebab-case from the problem, e.g. `app-performance`,
`checkout-idempotency`. If `docs/pm/<slug>/` already exists for different
work, disambiguate (`-2`) rather than overwrite.

With `Tool: ok, no remote`, skip the reservation and go to Phase 2.
Otherwise reserve the slug: `pm claim <slug> --draft --title "<one line>"
--type <type> --harness <yours>`. It writes a stub epic into the epic's own
worktree (`<repo>-pm-<slug>`) and pushes
`pm/<slug>`, so other sessions see this work from now on; every later
document for this epic goes into that worktree. On `owned by …` or `looks
like existing work`, show the user the owner or the look-alikes and ask;
with no way to ask, stop and report. Pass `--distinct` only after the user
says it is different work. `no origin remote` or `origin is unreachable`
(the remote changed since Phase 0): continue without a reservation and set
`Tool: ok, no remote`. A local `pm/<slug>` branch refusal means another
session in this checkout holds the slug, or an earlier attempt of yours did
not push: tell the user and ask before deleting anything. `push failed`:
rerun the printed push command once; if it still fails, keep working in the
epic's worktree with the printed session. The reservation is local only, so
other sessions cannot see it until `pm record` pushes `pm/<slug>` at
Phase 6; say so in the summary. Exit 2 `worktree`: rerun with
`--no-worktree` (see Degraded situations).

The claim prints `session: <id>`, even when its push failed. Put it on the
ledger's `Session:` line and pass `--session <id>` to `pm record` and every
`release` for this epic. Without it the tool treats you as another
session.

### Phase 2 — Research

Open Phase 2 with one message that reads `references/research.md`,
`references/elicitation.md` and `references/epic.template.md` together in
one step and runs `pm research` (step 1) beside those reads, where the host
allows parallel calls; otherwise read the three with one `cat`, then run
`pm research`. A non-interactive run adds the Phase 5 batch to that same
message: `references/plan.template.md`, `references/task.template.md`,
`references/prioritization.md`, and `references/memo.template.md` on a
cold start. Then gather evidence read-only, in this order of cost:

1. **One round trip, first**: `pm research <keywords> [--path ...] [--repo
   ...]` gives files, history, docs, prior investigations
   (`docs/sre-incidents/INDEX.md`, `docs/pm/INDEX.md`), tests and gh in one
   concurrent, read-only sweep. Run it in that first message: no `ls`,
   `find`, `git log` or `git show` before it. Copy its `[source] fact`
   lines into the ledger.
2. **Targeted reads**: open only the files and commits the output names,
   and take measurements or repros here; narrow and rerun `pm research`
   instead of grepping by hand.
3. **Breadth**: hosts with read-only subagents dispatch one per open
   question (Claude Code's Explore); hosts without run a narrowed
   `pm research` per open question. Both produce the same evidence form.

The epic's `repos` list names the target repositories by remote URL.
Resolve each through `docs/pm/.local/repos.json`; pass the mapped checkout
as `--repo` and research there. A repo not checked out on this machine
lowers the epic's confidence with that reason recorded; never clone.

Every finding lands in the ledger as `[source] fact`. Behavioral evidence
(measurements, logs, repro) outranks stated evidence (what the request
claims) — when they conflict, note the conflict rather than picking one.
What research cannot answer goes to `Open questions:`.

### Phase 3 — Elicit

Ask the user **only** the open questions — never what Phase 2 already
answered. Use the seven question categories from
`references/elicitation.md`, already read (affected users,
severity/frequency, business impact, constraints, prior attempts, what
"done" looks like, evidence conflicts) and cover each category either from
evidence or from a question. Use AskUserQuestion when available; batch
questions, don't drip them. The user declining to answer is itself an
answer — record the unknown and lower the epic's confidence.

### Phase 4 — Frame the epic (GATE)

Draft the epic from `references/epic.template.md`: problem statement with
cited evidence, hypothesis ("we believe X will improve M by Y within W"),
business-goal alignment, stakeholders, success metrics (primary + guardrail,
each with a numeric target and measurement window), scope, non-goals, open
questions.

Present a compact summary (problem, hypothesis, primary metric, scope,
non-goals) and ask the user to approve, adjust, or send you back to
research. **Stop. Do not write plan.md or any task until the epic framing
is approved.** On "adjust", revise and re-present; on approval, write the
epic. With a draft reservation from Phase 1, fill the stub in its worktree
(`<repo>-pm-<slug>/docs/pm/<slug>/epic.md`), keeping its `id`, `created` and
whole `session` block, `session.id` included. With a draft reservation you
already hold the claim; do not run `pm claim` again. Without one, write
`docs/pm/<slug>/epic.md` in the checkout (with `contract: 1`, `repos`,
`primary-metric`), then, unless the ledger says `Tool: ok, no remote`, run
`pm claim <slug> --harness <yours>`; it prints the session id the same way.
`owned by …` means another session has this epic: stop and tell the user.
A claimed epic's documents live in the worktree the claim printed, with
branch `pm/<slug>` checked out there; the user's own checkout keeps its
branch, and later commands find the worktree themselves. With no claim,
the documents stay in the checkout. Proceed.

### Phase 5 — Plan and decompose

After approval, read `references/plan.template.md`,
`references/task.template.md` and `references/prioritization.md` together
in one step, plus `references/memo.template.md` on a cold start. A
non-interactive run already read them with the Phase 2 batch. The plan and
tasks are not written file by file; they go into the Phase 6 bundle.

**Plan** (`docs/pm/<slug>/plan.md`): approach summary; milestones as
verifiable state transitions with exit criteria (never bare dates); risk
register (likelihood × impact, mitigation per risk); dependencies with
owners; MoSCoW scoping with recorded reasoning; definition of done;
validation plan that separates verification (meets the spec) from
validation (moves the epic's metric); changelog. The task table sits
between `<!-- pm:tasks:start -->` and `<!-- pm:tasks:end -->` and is
rendered from the task files; write everything else by hand and leave that
region empty.

**Tasks** (`docs/pm/<slug>/tasks/TNN-<short-slug>.md`, named after the
task, e.g. `T01-benchmark-orders.md`): each task follows INVEST:
independent where possible, small (split anything you cannot estimate or
that exceeds ~1–3 days of work), and testable via binary acceptance
criteria. Frontmatter carries the traceability chain (`epic`, `milestone`,
`depends-on`, `status`, `priority`, `estimate`). Write each task
self-contained: an agent or engineer picking it up cold must not need to
re-derive context — one paragraph of why, concrete what, explicit
out-of-scope.

Order tasks so that the riskiest assumption is tested earliest — for a
performance bug, "profile and confirm where time is spent" precedes any
optimization task.

### Phase 6 — Record

One `pm record` call writes the plan and tasks, writes the run log entry,
renders, checks, and commits. Pass `--session <id>` only when you hold a
claim; `-m` is the log entry text and the commit subject
(`docs(pm): <message>`).

```bash
pm record <slug> --harness <yours> [--session <id>] --kind spec -m "spec <slug>" --from - <<'PM_BUNDLE'
<!-- pm:file <slug>/plan.md -->
...the plan, task table region empty...
<!-- pm:file <slug>/tasks/T01-<short-slug>.md -->
...the first task...
<!-- pm:file pmanager-memo.md -->
...the memo (cold start only)...
PM_BUNDLE
```

Bundle rules:

- Each file opens with a marker line, alone on its line:
  `<!-- pm:file <path> -->`. The path is relative to `docs/pm/`: either
  `<slug>/….md` or `pmanager-memo.md`. Nothing goes before the first
  marker, and no section is empty.
- Marker lines inside fenced code blocks are content; close every fence.
- Write `plan.md` with the `<!-- pm:tasks:start -->` and
  `<!-- pm:tasks:end -->` markers and nothing between them; `pm record`
  renders the table.
- On a cold start the bundle carries the memo, built from
  `references/memo.template.md`. On a warm start, edit the hand-written
  sections of `docs/pm/pmanager-memo.md` in place (in the epic's worktree
  when claimed, else the checkout) only when this run learned something
  new, refresh `_Last updated:_`, and leave the memo out of the bundle.
  Never touch the changelog between its markers.
- Never put `INDEX.md`, `log/`, `.local/`, absolute paths, `..` segments,
  backslashes, another epic's files or non-`.md` files in the bundle;
  `pm record` refuses them.

When the host cannot pass a heredoc, write the bundle to a scratch file
outside the repo and pass `--from <file>`.

Outcomes:

- `committed <sha7> on <branch>, pushed`, or `unpushed:` with `no remote`,
  `no claim` or `origin unreachable`: done.
- `not committed:` with exit 0 (not a git repository, staged changes
  outside `docs/pm`, nothing to commit) or a git add or commit failure: the
  files are written; report it in the summary and run no git by hand.
- `push failed`: run the printed `retry with:` command once; if it still
  fails, say so in the summary.
- Exit 1 with check findings and `not committed: check errors`: fix each
  finding in its file, then rerun the same command without `--from`; the
  files are already written.
- Exit 1 `is not claimed; run pm claim <slug> first` (origin reachable, no
  claim held): nothing was written; run `pm claim <slug> --harness
  <yours>`, then rerun the same `pm record` command with the same bundle
  and `--session <id>` from the claim's output.
- Exit 1 `owned by …`: stop and tell the user.
- Exit 2: the bundle or usage was refused and nothing was written; fix the
  named problem and rerun the full command.
- Run no `git` by hand for any of this.

Finish with the final ledger and a short summary: epic slug and status
(awaiting approval when non-interactive), task count, the first task to
pick up, and the path of `plan.md`. No task table.

## Degraded situations

| Missing | Behavior |
| :--- | :--- |
| No repo / empty repo | Research from the user's description only; epic confidence marked low; say what evidence would raise it |
| `gh` unavailable | Skip issue/PR mining; note it in the ledger |
| User can't answer open questions | Record unknowns in the epic's Open questions; lower hypothesis confidence; prefer a discovery task (spike) as T01 |
| Request is too small for an epic (one obvious fix) | Say so — offer a single task file or no spec at all; don't inflate a typo fix into an epic |
| Non-interactive run (no way to ask or get approval) | Skip the elicitation round — record every uncovered category as an Open question; proceed past the Phase 4 gate with the epic marked `status: draft` and state clearly in the summary that the framing awaits human approval |
| Existing `docs/pm/` from manual edits | Hand-written sections are kept; rendered regions are regenerated by `pm render`; pre-tool documents get `render --migrate` after asking the user |
| Bun not installed | Print the user message and install steps from Phase 0; stop before tool-dependent steps; plan without the tool only if the user says so; ledger `Tool: unavailable` |
| No origin remote / unreachable | Claims, draft reservations and cross-session visibility are off for this run, so parallel sessions are not protected; say so; ledger `Tool: ok, no remote`; `pm record` commits on the checkout's current branch, unpushed; everything else proceeds |
| Epic already claimed by another session | Stop, name the owner and harness from the claim output; offer takeover only if status shows `[stale]` and the user asks |
| Worktree cannot be created (read-only parent, path taken, exotic filesystem) | Say so; rerun `claim` with `--no-worktree` and warn the user that this switches their current branch |

## Reference files — read when the phase goes deeper

| File | Read when |
| :--- | :--- |
| `references/commands.md` | Update, claim-management and handoff modes (the pm tool commands, failure handling, checker rules) |
| `references/memory.md` | Update mode (INDEX/memo schemas, recall and update rules, write-back) |
| `references/research.md` | Phase 2, together with elicitation.md and epic.template.md (evidence playbook) |
| `references/elicitation.md` | Phase 2 (read with research.md), used in Phase 3 (question categories and how to batch them) |
| `references/epic.template.md` | Phase 2 (read with research.md), used in Phase 4 (epic structure) |
| `references/plan.template.md` | Phase 5 (Phase 2 in a non-interactive run), together with task.template.md and prioritization.md |
| `references/task.template.md` | Phase 5 — task structure and INVEST checklist |
| `references/prioritization.md` | Phase 5 (MoSCoW within an epic); status queries that rank across epics (RICE / impact-effort) |
| `references/tracking.md` | Update mode — status transitions, `pm verify` for done claims, changelog rules, INDEX refresh |
| `references/memo.template.md` | Phase 5 on a cold start, with the other Phase 5 reads (memo skeleton) |
