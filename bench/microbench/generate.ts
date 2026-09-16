import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyRender } from "../../plugins/pmanager/skills/pmanager/scripts/render";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";

export interface GenerateOptions {
  epics: number;
  tasks: number;
}

const DATE = "2026-09-10";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function epicDoc(slug: string, i: number): string {
  return `---
id: ${slug}
title: Synthetic epic ${i}
type: tech-debt
status: in-progress
business-goal: Keep the benchmark honest
owner: unassigned
created: ${DATE}
updated: ${DATE}
contract: 1
repos:
  - git@github.com:example/repo-${i}.git
primary-metric: p95 endpoint-${i} < 500ms
---

# Synthetic epic ${i}

## Problem statement (required)

Endpoint ${i} is slow for users; the benchmark needs a realistic document set.

## Evidence (required)

| Source | Finding | Kind |
| :--- | :--- | :--- |
| [src/endpoint_${i}.py:10] | N+1 query | behavioral |
| [user] | "endpoint ${i} feels slow" | stated |

**Confidence:** medium — a profile would raise it.

## Hypothesis (required)

We believe batching queries will cut endpoint-${i} latency, measured by p95 reaching < 500ms within 1 week.

## Business goal alignment

Latency erodes trust.

## Stakeholders / affected users

Users of endpoint ${i}.

## Success metrics (required)

| Metric | Role | Current | Target | Window | Measured via |
| :--- | :--- | :--- | :--- | :--- | :--- |
| p95 endpoint-${i} latency | primary | unknown | < 500ms | 1 week post-ship | benchmark |

## Scope

- endpoint ${i} query path

## Non-goals (required)

- Storage rewrite.

## Open questions

- none

## Related prior work

none
`;
}

export function planDoc(slug: string, i: number): string {
  return `---
epic: ${slug}
status: in-progress
updated: ${DATE}
contract: 1
---

# Plan — Synthetic epic ${i}

## Approach

Confirm, then fix.

## Milestones

### M1 — Root cause confirmed
Exit criteria:
- [ ] Profile shows where time goes

## Task breakdown & traceability

<!-- pm:tasks:start -->
<!-- pm:tasks:end -->

## Prioritization

- Must: all tasks
- Should: none
- Could: none
- Won't (this epic): storage rewrite — out of scope.

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger / early signal |
| :--- | :--- | :--- | :--- | :--- |
| none | low | low | none | none |

## Dependencies

| Dependency | Kind | Owner | Status |
| :--- | :--- | :--- | :--- |
| none | internal | none | n/a |

## Definition of done (applies to every task)

- [ ] Acceptance criteria demonstrated

## Validation plan

- **Verification:** exit criteria demonstrated.
- **Validation:** p95 measured one week after ship.

## Changelog

| Date | Change | Why |
| :--- | :--- | :--- |
| ${DATE} | Plan created | — |
`;
}

export function taskDoc(slug: string, n: number): string {
  const id = `T${pad(n)}`;
  const dep = n === 1 ? "[]" : `[T${pad(n - 1)}]`;
  return `---
id: ${id}
epic: ${slug}
milestone: M1
title: Synthetic task ${n}
status: todo
priority: must
depends-on: ${dep}
estimate: S
owner: unassigned
updated: ${DATE}
contract: 1
---

# ${id} — Synthetic task ${n}

## Context

Step ${n} of the synthetic chain (../epic.md).

## What to do

Do step ${n}.

## Acceptance criteria

- [ ] Step ${n} artifact exists

## Out of scope

- Anything else.

## Notes
`;
}

export function logDoc(slug: string): string {
  return `---
date: ${DATE}
epic: ${slug}
harness: claude-code
kind: spec
---
spec'd ${slug}
`;
}

export const MEMO = `# PManager memo

_Last updated: ${DATE}_

## 1. Product context

Synthetic benchmark repository.

## 2. Business goals & north star

| Goal | Metric / north star | Source |
| :--- | :--- | :--- |
| Keep the benchmark honest | checker errors = 0 | [bench] |

## 3. Stakeholders

| Who | Cares about | Consulted via |
| :--- | :--- | :--- |
| maintainers | tool latency | this file |

## 4. Conventions & constraints

None.

## 5. Changelog

<!-- pm:log:start -->
<!-- pm:log:end -->
`;

export async function generatePmRepo(root: string, opts: GenerateOptions): Promise<void> {
  const pm = join(root, "docs", "pm");
  await mkdir(join(pm, "log"), { recursive: true });
  await writeFile(join(pm, "pmanager-memo.md"), MEMO);
  for (let i = 1; i <= opts.epics; i++) {
    const slug = `synthetic-${pad(i)}`;
    const dir = join(pm, slug);
    await mkdir(join(dir, "tasks"), { recursive: true });
    await writeFile(join(dir, "epic.md"), epicDoc(slug, i));
    await writeFile(join(dir, "plan.md"), planDoc(slug, i));
    for (let n = 1; n <= opts.tasks; n++) {
      await writeFile(join(dir, "tasks", `T${pad(n)}-synthetic-task-${n}.md`), taskDoc(slug, n));
    }
    await writeFile(join(pm, "log", `${DATE}-${slug}-${pad(i)}0000.md`), logDoc(slug));
  }
  await writeFile(join(pm, "INDEX.md"), "# PM index\n");
  await applyRender(await loadPmRepo(root));
}
