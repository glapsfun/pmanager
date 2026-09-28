import { describe, expect, test } from "bun:test";
import { isExploration, isFramingWrite, isResearchCall, type ToolCall } from "../boundary";
import { type TraceEvent, traceMetrics } from "../trace";

const call = (context: number): TraceEvent => ({ kind: "call", context });
const tool = (c: ToolCall): TraceEvent => ({ kind: "tool", ...c });
const result = (bytes: number): TraceEvent => ({ kind: "result", bytes });
const RESEARCH = "bun run .claude/skills/pmanager/scripts/pm.ts research orders slow --no-gh";

describe("isFramingWrite", () => {
  test("write tools on a docs/pm path", () => {
    expect(isFramingWrite({ tool: "Write", path: "/tmp/f/docs/pm/orders/epic.md" })).toBe(true);
    expect(isFramingWrite({ tool: "Edit", path: "docs/pm/INDEX.md" })).toBe(true);
    expect(isFramingWrite({ tool: "file_change", path: "docs/pm/x/epic.md" })).toBe(true);
    expect(isFramingWrite({ tool: "write", path: "docs/pm/x/epic.md" })).toBe(true);
    expect(isFramingWrite({ tool: "Read", path: "docs/pm/INDEX.md" })).toBe(false);
    expect(isFramingWrite({ tool: "Write", path: "app/app.py" })).toBe(false);
  });

  test("reservations at Phase 1 are not framing writes; the plain claim and render still are", () => {
    const pm = "bun run .claude/skills/pmanager/scripts/pm.ts";
    expect(
      isFramingWrite({
        tool: "Bash",
        command: `${pm} claim csv-export --draft --title "CSV export" --type feature --harness claude-code`,
      }),
    ).toBe(false);
    expect(isFramingWrite({ tool: "Bash", command: `${pm} release csv-export --abandon` })).toBe(
      false,
    );
    expect(isFramingWrite({ tool: "Bash", command: `${pm} claim csv-export` })).toBe(true);
    expect(isFramingWrite({ tool: "Bash", command: `${pm} render --epic csv-export` })).toBe(true);
    expect(
      isFramingWrite({
        tool: "Bash",
        command: `${pm} claim x --draft --title "T" --type feature && ${pm} render --epic x`,
      }),
    ).toBe(true);
    expect(
      isFramingWrite({
        tool: "Bash",
        command: `${pm} claim x --draft --title "T" --type bug; ${pm} claim y`,
      }),
    ).toBe(true);
    expect(
      isFramingWrite({
        tool: "Bash",
        command: `${pm} claim x --draft --title "T" --type bug && cat > docs/pm/x/epic.md <<'EOF'\n---\nEOF`,
      }),
    ).toBe(true);
    expect(
      isFramingWrite({
        tool: "Bash",
        command: `${pm} status && ${pm} claim x --draft --title "T" --type bug`,
      }),
    ).toBe(false);
  });

  test("shell commands that write under docs/pm, and ones that only read it", () => {
    const writes = [
      "mkdir -p docs/pm/orders/tasks docs/pm/log",
      "git checkout -b pm/orders && mkdir -p docs/pm/orders",
      "cat > docs/pm/orders/epic.md <<'EOF'\n---\nEOF",
      "echo row >> docs/pm/INDEX.md",
      "printf x | tee docs/pm/orders/plan.md",
      "cp /tmp/epic.md docs/pm/orders/epic.md",
      "bun run .claude/skills/pmanager/scripts/pm.ts claim orders --harness claude-code --no-worktree",
      "bun run .claude/skills/pmanager/scripts/pm.ts render --epic orders",
      "bun run .claude/skills/pmanager/scripts/pm.ts render --migrate",
      "bun run .claude/skills/pmanager/scripts/pm.ts release orders --harness claude-code",
    ];
    for (const command of writes) expect(isFramingWrite({ tool: "Bash", command })).toBe(true);
    const reads = [
      "cat docs/pm/INDEX.md",
      "ls docs/pm/ 2>/dev/null",
      "bun run .claude/skills/pmanager/scripts/pm.ts status --harness claude-code",
      "bun run .claude/skills/pmanager/scripts/pm.ts check --epic orders",
      "bun run .claude/skills/pmanager/scripts/pm.ts verify orders T01",
      "grep -rn orders docs/pm/ > /tmp/hits.txt",
      "mkdir -p /tmp/scratch",
    ];
    for (const command of reads) expect(isFramingWrite({ tool: "Bash", command })).toBe(false);
  });
});

describe("isResearchCall", () => {
  test("the pm research command only", () => {
    expect(isResearchCall({ tool: "Bash", command: RESEARCH })).toBe(true);
    expect(
      isResearchCall({
        tool: "command_execution",
        command: "bun run /x/skills/pmanager/scripts/pm.ts research orders",
      }),
    ).toBe(true);
    expect(
      isResearchCall({
        tool: "Bash",
        command: "cat .claude/skills/pmanager/references/research.md",
      }),
    ).toBe(false);
    expect(isResearchCall({ tool: "Read", path: "research.md" })).toBe(false);
  });
});

describe("isExploration", () => {
  test("looks at the fixture count; the skill's own files, bun --version and non-file tools do not", () => {
    expect(isExploration({ tool: "Bash", command: "ls -la" })).toBe(true);
    expect(isExploration({ tool: "Read", path: "app/app.py" })).toBe(true);
    expect(isExploration({ tool: "Grep", path: "." })).toBe(true);
    expect(isExploration({ tool: "Bash", command: "bun --version" })).toBe(false);
    expect(
      isExploration({
        tool: "Bash",
        command: "bun --version && bun run .claude/skills/pmanager/scripts/pm.ts status",
      }),
    ).toBe(false);
    expect(
      isExploration({ tool: "Read", path: "/f/.claude/skills/pmanager/references/research.md" }),
    ).toBe(false);
    expect(
      isExploration({ tool: "Bash", command: "cat /opt/plugin/skills/pmanager/SKILL.md" }),
    ).toBe(false);
    expect(isExploration({ tool: "Skill" })).toBe(false);
  });
});

describe("traceMetrics", () => {
  test("context growth and tool output up to the first docs/pm write; calls before research", () => {
    const events = [
      call(20000),
      tool({ tool: "Bash", command: "ls -la" }),
      result(10),
      call(20100),
      tool({ tool: "Bash", command: RESEARCH }),
      result(20),
      call(21000),
      tool({ tool: "Write", path: "docs/pm/orders/epic.md" }),
      result(5),
      call(22000),
      tool({ tool: "Bash", command: "cat app/app.py" }),
      result(99),
    ];
    expect(traceMetrics(events)).toEqual({
      preFramingContext: 1000,
      preFramingToolBytes: 30,
      preResearchCommands: 1,
    });
  });

  test("no boundary and no research give nulls; no calls give a null context", () => {
    expect(traceMetrics([call(5), tool({ tool: "Bash", command: "ls" }), result(3)])).toEqual({
      preFramingContext: null,
      preFramingToolBytes: null,
      preResearchCommands: null,
    });
    expect(traceMetrics([tool({ tool: "file_change", path: "docs/pm/x/epic.md" })])).toEqual({
      preFramingContext: null,
      preFramingToolBytes: 0,
      preResearchCommands: null,
    });
  });
});
