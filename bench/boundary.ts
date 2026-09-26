/** One tool call in harness-neutral form: the tool's name plus the path or command it acted on. */
export interface ToolCall {
  tool: string;
  path?: string;
  command?: string;
}

const WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "file_change",
  "write",
  "edit",
]);

const PM_TARGET = String.raw`["']?[^\s"'|;&<>]*docs/pm/`;
const SHELL_WRITES = [
  new RegExp(String.raw`>{1,2}\s*${PM_TARGET}`),
  new RegExp(String.raw`\btee\s+(-a\s+)?${PM_TARGET}`),
  new RegExp(String.raw`\bmkdir\s+(-p\s+)?${PM_TARGET}`),
  new RegExp(String.raw`\b(cp|mv)\s+[^|;&]*${PM_TARGET}`),
];

/** The end of pre-framing: the first write under docs/pm/, or a pm claim. */
export function isFramingWrite(c: ToolCall): boolean {
  if (WRITE_TOOLS.has(c.tool) && c.path?.includes("docs/pm/")) return true;
  const cmd = c.command;
  if (!cmd) return false;
  if (/pm\.ts\s+claim\b/.test(cmd)) return true;
  return cmd.includes("docs/pm/") && SHELL_WRITES.some((re) => re.test(cmd));
}

export function isResearchCall(c: ToolCall): boolean {
  return c.command !== undefined && /pm\.ts\s+research\b/.test(c.command);
}

const SKILL_DIRS = ["/skills/pmanager", ".claude/skills/", ".agents/skills/"];

/** A read or command aimed at the fixture itself rather than at the skill's own files. */
export function isExploration(c: ToolCall): boolean {
  const target = c.command ?? c.path;
  if (target === undefined) return false;
  if (SKILL_DIRS.some((d) => target.includes(d))) return false;
  return !/^\s*bun\s+--version\s*$/.test(target);
}
