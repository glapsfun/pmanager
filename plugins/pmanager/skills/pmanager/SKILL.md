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
2. **Read-only research.** Phases 0–3 read code, history, and docs; they
   change nothing. The only writes this skill ever makes are the spec
   documents under `docs/pm/`, their commits on the epic's `pm/<slug>`
   branch, and pushing that branch. Never `main`, never a target
   repository, never `--force`.
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

**Preflight.** Read `references/commands.md` and run its preflight (Bun
check, then `pm status`). The status output is the whole memory read: every
epic with its type, status, title, owner, session, stale claims, task
counts, updated date, repos, primary metric and next ready task (every
INDEX column), followed by the memo's hand-written sections (product
context, business goals, stakeholders, conventions; only the rendered
changelog is left out). Do not open `docs/pm/INDEX.md` or
`docs/pm/pmanager-memo.md` separately; they contain nothing the status
output does not.

From the rows, pick epics related to this request (same area, service, or
symptom — match semantically, not by exact string). Related prior epics are
leads: open their `epic.md`, note validated learnings and outcomes in the
ledger's `Memory:` line. `memo: absent` with no rows means a cold start —
note it and continue. Read `references/memory.md` for the schemas and
update rules.

**Route the request** into one of three modes:

- **New epic** — a problem/idea not covered by an existing epic → Phase 1.
- **Update** — the request references tracked work ("T02 is done", "add a
  task to app-performance", "we descoped X", "the epic looks good —
  approved") → read `references/tracking.md` and follow it; skip Phases 1–5.
- **Status query** — "where are we on…", "what's next" → answer from
  `pm status` + the epic's plan/tasks; write nothing unless asked.
- **Claim management** — "release the argocd epic", "take over
  infra-netbird-vm" → run `release` or `claim --takeover` per
  `references/commands.md`, confirm in one line, write nothing else.
- **Handoff** — "pick up T03", "brief for T02 of infra-netbird-vm" → run
  `handoff`, print the brief verbatim, write nothing.

### Phase 1 — Understand and scope

Extract from the request: the problem or idea as stated, the affected
system/users, type (bug, feature, tech debt, initiative), severity/urgency
signals, and any constraints already given. Restate the problem in one line
in the ledger. Do not ask the user anything yet — Phase 2 answers most
questions cheaper than an interview does.

### Phase 2 — Research

Read `references/research.md` for the playbook. Gather evidence read-only,
in this order of cost:

1. **One round trip**: `pm research <keywords> [--path ...] [--repo ...]`
   from `references/commands.md` — files, history, docs, prior
   investigations (`docs/sre-incidents/INDEX.md`, `docs/pm/INDEX.md`),
   tests and gh in one concurrent, read-only sweep. Copy its `[source]
   fact` lines into the ledger.
2. **Targeted reads**: open only the files and commits the output names;
   narrow and rerun instead of grepping by hand.
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
answered. Read `references/elicitation.md` for the seven question categories
(affected users, severity/frequency, business impact, constraints, prior
attempts, what "done" looks like, evidence conflicts) and cover each category
either from evidence or from a question. Use AskUserQuestion when available; batch
questions, don't drip them. The user declining to answer is itself an
answer — record the unknown and lower the epic's confidence.

### Phase 4 — Frame the epic (GATE)

Draft the epic from `references/epic.template.md`: problem statement with
cited evidence, hypothesis ("we believe X will improve M by Y within W"),
business-goal alignment, stakeholders, success metrics (primary + guardrail,
each with target and measurement window), scope, non-goals, open questions.

Present a compact summary (problem, hypothesis, primary metric, scope,
non-goals) and ask the user to approve, adjust, or send you back to
research. **Stop. Do not write plan.md or any task until the epic framing
is approved.** On "adjust", revise and re-present; on approval, write
`docs/pm/<slug>/epic.md` (with `contract: 1`, `repos`, `primary-metric`),
then run `pm claim <slug> --harness <yours>`. `owned by …` means another
session has this epic: stop and tell the user. Otherwise you are on branch
`pm/<slug>`; proceed.

Slug: short kebab-case from the problem, e.g. `app-performance`,
`checkout-idempotency`. If `docs/pm/<slug>/` already exists for different
work, disambiguate (`-2`) rather than overwrite.

### Phase 5 — Plan and decompose

Read `references/plan.template.md` and `references/task.template.md`.

**Plan** (`docs/pm/<slug>/plan.md`): approach summary; milestones as
verifiable state transitions with exit criteria (never bare dates); risk
register (likelihood × impact, mitigation per risk); dependencies with
owners; MoSCoW scoping with recorded reasoning (read
`references/prioritization.md`); definition of done; validation plan that
separates verification (meets the spec) from validation (moves the epic's
metric); changelog. The task table sits between `<!-- pm:tasks:start -->`
and `<!-- pm:tasks:end -->` and is rendered from the task files; write
everything else by hand.

**Tasks** (`docs/pm/<slug>/tasks/TNN-<slug>.md`): each task follows INVEST —
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

1. Write all documents under `docs/pm/<slug>/`.
2. Write the run log entry (`kind: spec`) as described in
   `references/commands.md`; do not edit the memo changelog.
3. Reconcile the memo's hand-written sections (goals, stakeholders,
   conventions) and refresh `_Last updated:_`. Create from
   `references/memo.template.md` on cold start.
4. `pm render`, then `pm check`; fix findings until exit 0. Commit on
   `pm/<slug>` and push it, per `references/memory.md` — the single source
   of truth for the commit command, message format, and its prohibitions.
5. Post the final ledger plus a one-screen summary: epic, milestone list,
   task table (id, title, priority, depends-on), and the suggested first
   task to pick up.

## Degraded situations

| Missing | Behavior |
| :--- | :--- |
| No repo / empty repo | Research from the user's description only; epic confidence marked low; say what evidence would raise it |
| `gh` unavailable | Skip issue/PR mining; note it in the ledger |
| User can't answer open questions | Record unknowns in the epic's Open questions; lower hypothesis confidence; prefer a discovery task (spike) as T01 |
| Request is too small for an epic (one obvious fix) | Say so — offer a single task file or no spec at all; don't inflate a typo fix into an epic |
| Non-interactive run (no way to ask or get approval) | Skip the elicitation round — record every uncovered category as an Open question; proceed past the Phase 4 gate with the epic marked `status: draft` and state clearly in the summary that the framing awaits human approval |
| Existing `docs/pm/` from manual edits | Hand-written sections are kept; rendered regions are regenerated by `pm render`; pre-tool documents get `render --migrate` after asking the user |
| Bun not installed | Print the user message and install steps from `references/commands.md`; stop before tool-dependent steps; plan without the tool only if the user says so; ledger `Tool: unavailable` |
| No origin remote / unreachable | Claims and cross-session visibility are off for this run; say so; ledger `Tool: ok, no remote`; everything else proceeds |
| Epic already claimed by another session | Stop, name the owner and harness from the claim output; offer takeover only if status shows `[stale]` and the user asks |

## Reference files — read when the phase goes deeper

| File | Read when |
| :--- | :--- |
| `references/commands.md` | Every run — preflight, the pm tool commands, Phase 6 order, checker rules |
| `references/memory.md` | Phase 0 bootstrap + Phase 6 record — INDEX/memo schemas, recall and update rules |
| `references/research.md` | Phase 2 — evidence playbook: pm research, targeted reads, breadth per host |
| `references/elicitation.md` | Phase 3 — question categories and how to batch them |
| `references/epic.template.md` | Phase 4 — epic structure |
| `references/plan.template.md` | Phase 5 — plan structure |
| `references/task.template.md` | Phase 5 — task structure and INVEST checklist |
| `references/prioritization.md` | Phase 5 (MoSCoW within an epic) and cross-epic calls (RICE / impact-effort) |
| `references/tracking.md` | Update mode — status transitions, changelog rules, INDEX refresh |
| `references/memo.template.md` | Phase 6 cold start — memo skeleton |
