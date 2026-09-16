import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  EPIC_REQUIRED_FIELDS,
  EPIC_REQUIRED_SECTIONS,
  EPIC_STATUSES,
  EPIC_TYPES,
  EPIC_V1_FIELDS,
  ESTIMATES,
  PLAN_REQUIRED_FIELDS,
  PLAN_REQUIRED_SECTIONS,
  PRIORITIES,
  TASK_REQUIRED_FIELDS,
  TASK_REQUIRED_SECTIONS,
  TASK_STATUSES,
  TASK_V1_FIELDS,
} from "../plugins/pmanager/skills/pmanager/scripts/contract";
import {
  LOG_END,
  LOG_START,
  TASKS_END,
  TASKS_START,
} from "../plugins/pmanager/skills/pmanager/scripts/render";

export const CONTRACT_REL = "docs/pm/CONTRACT.md";

const code = (xs: readonly string[]) => xs.map((x) => `\`${x}\``).join(", ");
const sections = (xs: readonly string[]) => xs.map((s) => `## ${s}`).join("\n");

/** Format only: what files exist, what fields and sections they carry. No workflow guidance. */
export function renderContract(): string {
  return `# Planning document format

Planning documents live under \`docs/pm/\`. This file describes the format; it is not itself a planning document.

## Layout

\`\`\`text
docs/pm/
├── INDEX.md                  # one table row per epic, regenerated from frontmatter
├── pmanager-memo.md          # product memo; its changelog section is regenerated from log/
├── log/YYYY-MM-DD-<slug>-<6 hex>.md   # one file per run: frontmatter date, epic, harness, kind (spec | update)
└── <slug>/
    ├── epic.md
    ├── plan.md
    └── tasks/TNN-<short-slug>.md
\`\`\`

## epic.md

YAML frontmatter with ${code(EPIC_REQUIRED_FIELDS)} and ${code(EPIC_V1_FIELDS)} (\`contract: 1\`, \`repos\` is a list of remote URLs, may be empty).
\`type\` is one of ${code(EPIC_TYPES)}. \`status\` is one of ${code(EPIC_STATUSES)}. Dates are YYYY-MM-DD.
When nobody is available to approve the framing, leave \`status: draft\`.

Body sections, in this order, each non-empty:

${sections(EPIC_REQUIRED_SECTIONS)}

Evidence is a table with columns Source, Finding, Kind; Source is \`[path:line]\`, \`[git log]\`, \`[user]\`, or a URL. Success metrics is a table with columns Metric, Role, Current, Target, Window, Measured via; exactly one row has Role \`primary\`.

## plan.md

Frontmatter ${code(PLAN_REQUIRED_FIELDS)} (\`status\` mirrors the epic) and \`contract: 1\`. Sections:

${sections(PLAN_REQUIRED_SECTIONS)}

The task table is regenerated from the task files and sits between these two lines, which must both be present exactly once:

\`\`\`text
${TASKS_START}
${TASKS_END}
\`\`\`

Changelog is a table with columns Date, Change, Why.

## tasks/TNN-<short-slug>.md

Frontmatter ${code(TASK_REQUIRED_FIELDS)} and ${code(TASK_V1_FIELDS)}. \`status\` is one of ${code(TASK_STATUSES)}; \`priority\` one of ${code(PRIORITIES)}; \`estimate\` one of ${code(ESTIMATES)}; \`depends-on\` is a list of task ids, possibly empty. Sections:

${sections(TASK_REQUIRED_SECTIONS)}

Acceptance criteria are checkbox lines (\`- [ ]\`). A criterion is checked (\`- [x]\`) only when it was verified against the repository; a completion claim that cannot be verified is recorded with the line \`**unverified** — <why>\` under Acceptance criteria instead.

## pmanager-memo.md

Hand-written sections for product context, goals, stakeholders, conventions, and a changelog section whose content is regenerated between:

\`\`\`text
${LOG_START}
${LOG_END}
\`\`\`

## Rendering and validation

\`INDEX.md\`, plan task tables, and the memo changelog are derived views. The tool \`bun run <skill>/scripts/pm.ts render\` regenerates them and \`... check\` validates every document; when the tool is not available, keep the derived views consistent by hand.
`;
}

export async function installContract(fixtureDir: string): Promise<string> {
  const text = renderContract();
  const path = join(fixtureDir, CONTRACT_REL);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  const exclude = join(fixtureDir, ".git", "info", "exclude");
  await mkdir(dirname(exclude), { recursive: true });
  await appendFile(exclude, `${CONTRACT_REL}\n`);
  return text;
}
