# Research playbook (Phase 2)

Goal: answer as many questions as possible **before** interviewing the user,
and produce an Evidence table where behavioral findings outrank stated ones.
Everything here is read-only.

## Order of cost — stop early when the picture is clear

The same three steps on every host. The tool does the parallel part, so
Claude Code and Codex run identical commands and get identical evidence.

### 1. One round trip — `pm research`

Pick 2–5 keywords from the Phase 1 problem line (the symptom, the
endpoint, the module, the table); they match literally, case-insensitive,
never as regular expressions. Run once:

    pm research <keyword>... [--path <dir>]... [--repo <name|path>]

- `--path` whenever the request or Phase 0 memory already names the area
  (`--path app/orders --path db/`). It scopes every probe and the header
  records what was searched, so the ledger can say what was not.
- `--repo` for each target repository the request names, resolved through
  `docs/pm/.local/repos.json`; a name that is not mapped lowers the epic's
  confidence with that reason recorded. Never clone.
- `--no-gh` when the ledger already says gh is unavailable.

The output is six sections, every line already in `[source] fact` form:
`files` (top hits with matching lines), `history` (commits touching those
files or mentioning a keyword), `docs` (READMEs, ADRs, runbooks), `memory`
(matching rows of `docs/sre-incidents/INDEX.md` and `docs/pm/INDEX.md`),
`tests` (tests around the area), `gh` (merged PRs and issues, or
`gh: unavailable (<reason>)`). Copy the lines that matter into the
ledger's Evidence unchanged. A confirmed incident root cause in `memory`
is the strongest evidence a bug-epic can cite.

### 2. Targeted reads

Open only the files and commits the output names, to confirm what a line
means or read the code around it: the request path for a performance
complaint, the test that encodes the promised behavior, the ADR that
explains a constraint. Rule: when a `--path` is known, never grep the whole
repository by hand; narrow the keywords or the path and run `pm research`
again.

### 3. Breadth — one route per host

- Hosts with read-only subagents (Claude Code's Explore): dispatch one per
  open question, concurrently, with the problem statement, the question,
  and "return facts with file:line citations". Typical splits: "where is X
  implemented", "what consumes Y", "what config governs Z".
- Hosts without them (Codex and others): run `pm research` once per open
  question with narrowed keywords or a different `--path`, one after the
  other. Same evidence form, one command each.

## Evidence discipline

- Every finding: `[source] fact` — the source is a path:line, `[git log]`,
  `[gh pr #N]`, `[gh issue #N]`, a command, a URL, or `[user]`. Lines from
  `pm research` are already in this form.
- **Behavioral > stated.** A measurement, repro, log, or diff beats what
  the request claims. When they conflict, record both and the conflict —
  Phase 3 asks the user about it; Phase 4 lowers confidence.
- Facts, not interpretations. "p95 is 3.1s [dashboard]" is evidence;
  "the DB is slow" is a hypothesis — it goes in the ledger's `Hypothesis:`
  line, supported by evidence numbers.
- What you could not find out is as important as what you found: write it
  to `Open questions:` — that list *is* Phase 3's agenda.

## When the repo can't answer

No repo, empty repo, or the problem lives outside code (org process, third
party): research from the request text and any linked material alone, mark
epic confidence low, and prefer a discovery/spike task as T01 so the first
unit of work buys the missing evidence.
