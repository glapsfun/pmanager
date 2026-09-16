# pmanager

Agentic technical project/product manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Codex, Gemini CLI, Copilot CLI, and any agent that supports the [Agent Skills](https://agentskills.io) standard. It turns raw problems and ideas into evidence-backed, spec-oriented work.

[![gate](https://github.com/glapsfun/pmanager/actions/workflows/gate.yml/badge.svg)](https://github.com/glapsfun/pmanager/actions/workflows/gate.yml)
[![bench](https://github.com/glapsfun/pmanager/actions/workflows/bench.yml/badge.svg)](https://github.com/glapsfun/pmanager/actions/workflows/bench.yml)
[![plugin version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fglapsfun%2Fpmanager%2Fmain%2Fplugins%2Fpmanager%2F.claude-plugin%2Fplugin.json&query=%24.version&label=plugin&color=blue)](plugins/pmanager/.claude-plugin/plugin.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![runtime: Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![Agent Skills](https://img.shields.io/badge/standard-Agent%20Skills-8a2be2)](https://agentskills.io)
[![install with gskill](https://img.shields.io/badge/install%20with-gskill-0a7f5a?logo=bun&logoColor=white)](https://github.com/glapsfun/gskill)
[![harnesses](https://img.shields.io/badge/harnesses-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20pi%20%C2%B7%20Gemini%20%C2%B7%20Copilot-555)](#benchmark)

Distributed as a single-plugin [Claude Code plugin marketplace](https://docs.anthropic.com/en/docs/claude-code) and as a standard Agent Skill.

## What it does

Behave like an experienced technical PM sitting next to you. You say
*"we have a performance bug in the app"* and the agent does **not** jump to a
task list. It researches the repo, history, and prior investigations first,
asks you only what research can't answer, frames the problem as an epic with
a testable hypothesis and measurable success metrics, and only after you
approve the framing decomposes it into a plan and executable tasks.

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

1. **Bootstrap memory**: read the product memo and epic index; recall related prior epics and sre-agent incidents; route the request (new epic / update / status query).
2. **Understand** the problem as stated.
3. **Research** read-only: code paths, docs, ADRs, git history, PRs/issues, prior incidents. Every finding is cited `[source] fact`; behavioral evidence outranks stated claims.
4. **Elicit**: one batched round of questions covering only what research couldn't answer (affected users, severity, business impact, constraints, prior attempts, definition of done).
5. **Frame the epic**: hypothesis, primary and guardrail metrics with targets and windows, scope, non-goals. Then **wait for your approval** (a hard gate).
6. **Plan and decompose**: milestones with binary exit criteria, risk register, dependencies, MoSCoW with recorded reasoning; INVEST tasks with binary acceptance criteria, each self-contained enough to hand to an agent or engineer cold.
7. **Record and track**: write the docs, update the index and memo, commit locally (scoped, never pushed). Later runs update task status, verify "done" claims against the repo, and remind you when validation (did the metric move?) is due.

## Quick start

The fastest path is gskill below. Whichever route you take, the skill ships a small TypeScript tool (checker, renderer, claim, handoff)
that runs on [Bun](https://bun.sh). Install it once per machine:

```bash
curl -fsSL https://bun.sh/install | bash
```

Without Bun the agent will stop and print these instructions before doing
any tool-dependent work.

### Recommended: install with gskill

[gskill](https://github.com/glapsfun/gskill) treats skills like dependencies: pmanager is resolved from this repo, content-hashed, recorded in a committed `skills-lock.json`, and restored byte-for-byte on any machine or in CI. You already have Bun for the pm tool, so install gskill with it once:

```bash
bun install --global @glapsfun/gskill
```

Then add pmanager from the project that should get the skill, one command per agent:

```bash
gskill add github.com/glapsfun/pmanager --skill pmanager --agent claude
gskill add github.com/glapsfun/pmanager --skill pmanager --agent codex
gskill add github.com/glapsfun/pmanager --skill pmanager --agent gemini-cli
gskill add github.com/glapsfun/pmanager --skill pmanager --agent cursor
```

Commit `skills-lock.json`. Teammates and CI then get the identical version with:

```bash
gskill install --frozen-lockfile
```

Keep it current and honest:

```bash
gskill project verify           # re-hash the installed skill against the lock
gskill update --list            # see newer pmanager releases
gskill upgrade pmanager --latest
```

No Bun on a teammate's machine? `bunx @glapsfun/gskill …` and `npx @glapsfun/gskill …` run it without installing, and gskill also ships via Homebrew (`brew install glapsfun/tap/gskill`), Go, and an install script; see its [quick start](https://github.com/glapsfun/gskill#quick-start). It installs the skill folder, which is the whole product: pmanager triggers on planning and scoping language without a slash command. Only the optional `/pmanager` command needs the Claude Code plugin route below.

### Claude Code plugin (adds the `/pmanager` slash command)

```
/plugin marketplace add glapsfun/pmanager
/plugin install pmanager@pmanager
```

<details>
<summary>Update, remove, and the non-interactive CLI form</summary>

The marketplace registers under the alias **`pmanager`** from the `name`
field in `.claude-plugin/marketplace.json`.

```
/plugin marketplace update pmanager   # update after a new version is published
/plugin remove pmanager               # remove
```

Non-interactive, from a shell:

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
> passes that string as a model prompt, not as a plugin command. Use
> `claude plugin ...` (no leading slash) for non-interactive use.

</details>

### Alternative: `npx skills` (Codex, Gemini CLI, Copilot CLI)

```bash
npx skills add glapsfun/pmanager --skill pmanager --agent codex --global -y
npx skills add glapsfun/pmanager --skill pmanager --agent gemini-cli --global -y
npx skills add glapsfun/pmanager --skill pmanager --agent copilot --global -y
```

<details>
<summary>Scope, verification, and what the standard does not carry</summary>

The commands above install the `plugins/pmanager/skills/pmanager/` folder
into the target agent's global skills directory. Omit `--global` to install
into the current project instead. Verify with `npx skills list -a codex`,
and restart the agent afterwards so the new skill metadata is loaded.

`npx skills` implements the Agent Skills standard and copies **only** the
skill folder. The plugin-level `commands/` directory is not part of that
standard, so the `/pmanager` slash command comes only from the Claude Code
plugin install. The skill itself is fully functional standalone: it triggers
on planning and scoping language without the explicit command.

</details>

### Local / development install

```bash
git clone https://github.com/glapsfun/pmanager.git
```

<details>
<summary>Registering the clone</summary>

Inside Claude Code, using the absolute path to your clone:

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

</details>

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

## Working across sessions

`/pmanager T02 of app-performance is done` updates the task, the plan's
task table, and the index, and verifies checkable acceptance criteria
against the repo instead of silently trusting the claim. `/pmanager what's
next?` answers from the index, respecting dependencies and priorities.

Several agent sessions, on any mix of harnesses, can plan different epics in
the same orchestration repo:

- **Branch = claim.** Approving an epic pushes `pm/<slug>`; a second session
  that tries the same epic is told who owns it. Merge the branch through a PR
  and delete it to release the epic.
- **Rendered views.** `INDEX.md`, each plan's task table, and the memo
  changelog are generated from task and epic frontmatter, so two branches
  never conflict on them. After merging, run the renderer once.
- **Handoff, not execution.** "pick up T03" prints a self-contained brief for
  whoever implements it: the same session, another agent, or you. The skill
  never runs code in a target repository.
- **Checker.** `pm check` validates every document deterministically and
  prints the fix for each finding; the agent runs it before every commit.

## Benchmark

`bench/` measures the skill on any harness with a headless mode. Each
scenario builds a fixture repo, runs the skill through the harness, and
scores the produced documents with deterministic checks (the skill's own
checker, evidence citations, task ordering, approval gates, claim handling).
Score is the share of checks passed; 1.00 means every check passed. Fresh
tokens are the uncached prompt tokens the harness paid for, on one definition
for every harness. Cost is shown only where the harness reports it; Codex reports tokens but no dollars, so its rows carry fresh tokens and a blank cost. The model cell includes the reasoning effort when one was requested. A free
microbench times the `pm` tool on a large synthetic `docs/pm`.

The table below is rendered by `bun run bench/bench.ts report` from
`bench/results/history.jsonl`. Details and history: [bench/README.md](bench/README.md)
and [bench/BENCH.md](bench/BENCH.md).

<!-- bench:start -->
| Harness | Model | Scenario | Score | Duration | Fresh tokens | Cost |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: |
| claude-code 2.1.273 | claude-opus-5[1m] | feature-idea-epic | 1.00 | 294s | 52768 | $1.41 |
| claude-code 2.1.273 | claude-opus-5[1m] | perf-bug-new-epic | 1.00 | 261s | 50226 | $1.20 |
| claude-code 2.1.273 | claude-opus-5[1m] | tracking-update-memory | 1.00 | 97s | 28694 | $0.54 |
| claude-code 2.1.273 | claude-opus-5[1m] | two-session-claim-conflict | 1.00 | 40s | 23421 | $0.37 |
| codex 0.154.0 | — | feature-idea-epic | 1.00 | 174s | 27028 | — |
| codex 0.154.0 | — | perf-bug-new-epic | 1.00 | 200s | 29465 | — |
| codex 0.154.0 | — | tracking-update-memory | 1.00 | 72s | 23896 | — |
| codex 0.154.0 | — | two-session-claim-conflict | 1.00 | 47s | 22431 | — |

## Experiments

| Experiment | Harness | Model | Scenario | Pairs (excluded) | Success with / without | Score diff median | Fresh tokens with / without | Cost |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| codex-2 (preliminary) | codex 0.154.0 | gpt-6-astra (high) | perf-bug-new-epic | 1 (1) | 0% / 0% | +0.29 | 44875 / 33725 | — |
| pilot-2 (preliminary) | claude-code 2.1.273 | claude-sonnet-5 | perf-bug-new-epic | 1 (1) | 100% / 0% | +0.21 | 61243 / 46930 | $1.29 |

Tool microbench: status 102 ms, check 123 ms, render 95 ms (median on 50 epics, 1000 tasks).

_Last run: 2026-09-16 at 2569592._
<!-- bench:end -->

## What it will never do

- Write plan or tasks before you approve the epic framing, with one
  explicit exception: in a non-interactive run (nobody available to ask),
  it proceeds with the epic marked `draft`, says so in its summary, and
  waits for your "approved" on the next invocation to flip it.
- Invent metric targets you didn't confirm and evidence didn't establish.
- Push anything except the epic's own `pm/<slug>` branch of the orchestration
  repo (never `main`, never a target repo, never with force), bare-commit, or
  touch anything outside `docs/pm/` (research is read-only).
- Execute tasks in a target repository. It hands off a brief and tracks the
  result.
- Record secrets or PII in the docs. Metadata and reasoning only.

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
bench/
├── bench.ts                      # CLI: run <harness>, tool, report
├── scenarios/ adapters/ graders/ # fixtures + prompts, harness drivers, deterministic checks
├── microbench/                   # pm tool timings on a synthetic docs/pm
├── results/history.jsonl         # append-only run history (committed)
└── BENCH.md                      # rendered report
.github/workflows/gate.yml        # CI: bun run gate + tool microbench on every PR
.github/workflows/bench.yml       # CI: agent benchmark on dispatch, weekly, or the `bench` label
```

## License

[MIT](LICENSE)
