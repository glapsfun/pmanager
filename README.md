# pmanager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Agentic technical project/product manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, Gemini CLI, Copilot CLI, and any agent that supports the [Agent Skills](https://agentskills.io) standard — an assistant that turns raw problems and ideas into evidence-backed, spec-oriented work.

Distributed as a single-plugin [Claude Code plugin marketplace](https://docs.anthropic.com/en/docs/claude-code) and as a standard Agent Skill.

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

---

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

---

## Benchmark

`bench/` measures the skill on any harness with a headless mode (Claude Code, Codex CLI, pi): deterministic scores from the produced documents, plus tokens, cost, and timing where the harness reports them, and a free microbench of the `pm` tool. See `bench/README.md` and `bench/BENCH.md`.

## Installation

### Requirement — Bun

The skill ships a small TypeScript tool (checker, renderer, claim, handoff)
that runs on [Bun](https://bun.sh). Install it once per machine:

```bash
curl -fsSL https://bun.sh/install | bash
```

Without Bun the agent will stop and print these instructions before doing
any tool-dependent work.

### Method 1 — Claude Code (slash commands, recommended)

**Step 1 — Add the marketplace** (one-time per machine):

```
/plugin marketplace add glapsfun/pmanager
```

This registers the marketplace under the alias **`pmanager`** from the `name`
field in `.claude-plugin/marketplace.json`.

**Step 2 — Install the plugin**:

```
/plugin install pmanager@pmanager
```

To update after a new version is published:

```
/plugin marketplace update pmanager
```

To remove:

```
/plugin remove pmanager
```

### Method 2 — Claude Code CLI (non-interactive)

```bash
claude plugin marketplace add glapsfun/pmanager
claude plugin install pmanager@pmanager
```

With npx (no prior global install required):

```bash
npx @anthropic-ai/claude-code plugin marketplace add glapsfun/pmanager
npx @anthropic-ai/claude-code plugin install pmanager@pmanager
```

> Note: `claude "/plugin ..."` (with the slash command as a quoted string)
> passes that string as a model prompt, not as a plugin command — use
> `claude plugin ...` (no leading slash) for non-interactive use.

### Method 3 — Agent Skill (`npx skills`)

Installs the `plugins/pmanager/skills/pmanager/` folder into the target
agent's global skills directory:

```bash
npx skills add glapsfun/pmanager --skill pmanager --agent codex --global -y
npx skills add glapsfun/pmanager --skill pmanager --agent gemini-cli --global -y
npx skills add glapsfun/pmanager --skill pmanager --agent copilot --global -y
```

Omit `--global` to install into the current project instead. Verify with
`npx skills list -a codex`, and restart the agent afterwards so the new skill
metadata is loaded.

> **Note:** `npx skills` implements the Agent Skills standard and copies
> **only** the skill folder. The plugin-level `commands/` directory is not
> part of that standard, so the `/pmanager` slash command comes only from the
> Claude Code plugin install (Method 1 or 2). The skill itself is fully
> functional standalone — it triggers on planning and scoping language
> without the explicit command.

### Method 4 — Local / development install

```bash
git clone https://github.com/glapsfun/pmanager.git
```

Then, inside Claude Code, using the absolute path to your clone:

```
/plugin marketplace add /path/to/pmanager
/plugin install pmanager@pmanager
```

The path must point to the repo root (the directory containing
`.claude-plugin/marketplace.json`).

For local Agent Skill development, run from the repo root:

```bash
npx skills add . --skill pmanager --agent codex --global -y
```

---

## Usage

```text
/pmanager we have a performance problem in the app — checkout feels slow since July
/pmanager plan out multi-tenant support as an epic
/pmanager T01 of app-performance is done, T02 is blocked on the DBA review
/pmanager status — what should we pick up next?
```

Or just describe the problem in plain words; the skill triggers on planning
and scoping requests without the explicit command.

See the [plugin README](plugins/pmanager/README.md) for the overview and the
[skill usage guide](plugins/pmanager/skills/pmanager/README.md) for a full
worked example.

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

## Repository layout

```text
.claude-plugin/marketplace.json   # marketplace manifest (one plugin)
plugins/pmanager/
├── .claude-plugin/plugin.json    # Claude Code plugin manifest
├── .codex-plugin/plugin.json     # Codex plugin manifest
├── commands/pmanager.md          # /pmanager slash command
└── skills/pmanager/
    ├── SKILL.md                  # skill definition (7-phase loop)
    ├── README.md                 # usage guide + worked example
    ├── scripts/pm.ts             # pm tool: check, render, claim, release, status, handoff (Bun)
    ├── tests/                    # bun test suite + webshop fixture
    ├── package.json              # bun run gate → typecheck, lint, test
    ├── evals/evals.json          # skill evals
    └── references/               # playbooks, command reference, templates
.github/workflows/gate.yml        # CI: bun run gate on every PR
```

## License

[MIT](LICENSE)
