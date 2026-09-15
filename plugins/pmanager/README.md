# pmanager

Agentic technical project/product manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, Gemini CLI, Copilot CLI, and any agent that supports the [Agent Skills](https://agentskills.io) standard — an assistant that turns raw problems and ideas into evidence-backed, spec-oriented work.

## Main goal

Behave like an experienced technical PM sitting next to you. You say
*"we have a performance bug in the app"* — the agent does **not** jump to a
task list. It researches the repo, history, and prior investigations first,
asks you only what research can't answer, frames the problem as an epic with
a testable hypothesis and measurable success metrics, and — only after you
approve the framing — decomposes it into a plan and executable tasks.

One directory per epic under `docs/pm/` of an orchestration repo; code lives
in the target repos the epic references:

```text
manager/                          # orchestration repo — planning state only
└── docs/pm/
    ├── INDEX.md                  # rendered: one row per epic with owner, session, repos
    ├── pmanager-memo.md          # product memo; changelog rendered from log/
    ├── log/                      # one file per run (merge-safe changelog)
    ├── argocd-compute-class/     # epic owned by session 1 (repos: argocd)
    │   ├── epic.md · plan.md · tasks/
    └── infra-netbird-vm/         # epic owned by session 2 (repos: infra)
        ├── epic.md · plan.md · tasks/
argocd/  infra/                   # target repos — code lives here, never touched by the skill
```

The agent follows an evidence-first loop:

1. **Bootstrap memory** — read the product memo and epic index; recall related prior epics and sre-agent incidents; route the request (new epic / update / status query).
2. **Understand** the problem as stated.
3. **Research** read-only: code paths, docs, ADRs, git history, PRs/issues, prior incidents — every finding cited `[source] fact`; behavioral evidence outranks stated claims.
4. **Elicit** — one batched round of questions covering only what research couldn't answer (affected users, severity, business impact, constraints, prior attempts, definition of done).
5. **Frame the epic** — hypothesis, primary + guardrail metrics with targets and windows, scope, non-goals — and **wait for your approval** (a hard gate).
6. **Plan & decompose** — milestones with binary exit criteria, risk register, dependencies, MoSCoW with recorded reasoning; INVEST tasks with binary acceptance criteria, each self-contained enough to hand to an agent or engineer cold.
7. **Record & track** — write the docs, update the index and memo, commit locally (scoped, never pushed). Later runs update task status, verify "done" claims against the repo, and remind you when validation (did the metric move?) is due.

## Task tracking across sessions

`/pmanager T02 of app-performance is done` updates the task, the plan's
task table, and the index — and verifies checkable acceptance criteria
against the repo instead of silently trusting the claim. `/pmanager what's
next?` answers from the index, respecting dependencies and priorities.

## Multi-session planning

Several agent sessions, on any mix of harnesses, can plan different epics in
the same orchestration repo:

- **Branch = claim.** Approving an epic pushes `pm/<slug>`; a second session
  that tries the same epic is told who owns it. Merge the branch through a PR
  and delete it to release the epic.
- **Rendered views.** `INDEX.md`, each plan's task table, and the memo
  changelog are generated from task and epic frontmatter, so two branches
  never conflict on them. After merging, run the renderer once.
- **Handoff, not execution.** "pick up T03" prints a self-contained brief for
  whoever implements it — the same session, another agent, or you. The skill
  never runs code in a target repository.
- **Checker.** `pm check` validates every document deterministically and
  prints the fix for each finding; the agent runs it before every commit.

## Installation

### Requirement — Bun

The skill ships a small TypeScript tool (checker, renderer, claim, handoff)
that runs on [Bun](https://bun.sh). Install it once per machine:

```bash
curl -fsSL https://bun.sh/install | bash
```

Without Bun the agent will stop and print these instructions before doing
any tool-dependent work.

| Target | Install |
| :--- | :--- |
| **Claude Code** | `/plugin marketplace add glapsfun/pmanager` (once), then `/plugin install pmanager@pmanager` |
| **Codex** | `npx skills add glapsfun/pmanager --skill pmanager --agent codex --global -y` |
| **Gemini CLI** | `npx skills add glapsfun/pmanager --skill pmanager --agent gemini-cli --global -y` |
| **Copilot CLI** | `npx skills add glapsfun/pmanager --skill pmanager --agent copilot --global -y` (also picks up `.claude/skills/` installs) |

On Claude Code, `/plugin install` additionally registers the `/pmanager`
command.

## Usage

```text
/pmanager we have a performance problem in the app — checkout feels slow since July
/pmanager plan out multi-tenant support as an epic
/pmanager T01 of app-performance is done, T02 is blocked on the DBA review
/pmanager status — what should we pick up next?
```

Or just describe the problem in plain words; the skill triggers on planning
and scoping requests without the explicit command.

## What it will never do

- Write plan or tasks before you approve the epic framing — with one
  explicit exception: in a non-interactive run (nobody available to ask),
  it proceeds with the epic marked `draft`, says so in its summary, and
  waits for your "approved" on the next invocation to flip it.
- Invent metric targets you didn't confirm and evidence didn't establish.
- Push anything except the epic's own `pm/<slug>` branch of the orchestration
  repo (never `main`, never a target repo, never with force), bare-commit, or
  touch anything outside `docs/pm/` (research is read-only).
- Execute tasks in a target repository — it hands off a brief and tracks the
  result.
- Record secrets or PII in the docs — metadata and reasoning only.
