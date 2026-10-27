export interface BundleFile {
  path: string;
  content: string;
}

export type BundleResult = { ok: true; files: BundleFile[] } | { ok: false; error: string };

const MARKER = /^<!-- pm:file (.+?) -->\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

interface Fence {
  char: string;
  length: number;
}

/** CommonMark: a backtick fence's info string has no backtick. */
function opening(line: string): Fence | null {
  const m = FENCE.exec(line);
  const run = m?.[1];
  if (!run || (run[0] === "`" && m[2]?.includes("`"))) return null;
  return { char: run[0] ?? "", length: run.length };
}

/** CommonMark: the same character, at least as long as the opening, nothing after it. */
function closes(line: string, fence: Fence): boolean {
  const m = FENCE.exec(line);
  const run = m?.[1];
  return !!run && run[0] === fence.char && run.length >= fence.length && m[2]?.trim() === "";
}

function pathError(path: string, slug: string): string | null {
  if (path.includes("\\")) return `bundle path ${path} contains a backslash; use /`;
  if (CONTROL.test(path)) {
    return `bundle path ${JSON.stringify(path)} contains a control character`;
  }
  if (path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    return `bundle path ${path} has an empty, . or .. segment`;
  }
  const inEpic =
    path.startsWith(`${slug}/`) && path.endsWith(".md") && path.length > slug.length + 4;
  if (inEpic || path === "pmanager-memo.md") return null;
  return `bundle path ${path} must be ${slug}/<...>.md or pmanager-memo.md`;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

/** Split a bundle of `<!-- pm:file <path> -->` sections into files, or refuse at the first problem. */
export function parseBundle(text: string, slug: string): BundleResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: { path: string; lines: string[] }[] = [];
  const seen = new Set<string>();
  let fence: Fence | null = null;
  let stray = false;

  for (const line of lines) {
    const inFence = fence !== null;
    if (fence === null) fence = opening(line);
    else if (closes(line, fence)) fence = null;
    const path = inFence || fence !== null ? undefined : MARKER.exec(line)?.[1];
    if (path !== undefined) {
      if (stray) return { ok: false, error: "text before the first pm:file marker" };
      const err = pathError(path, slug);
      if (err) return { ok: false, error: err };
      if (seen.has(path)) return { ok: false, error: `bundle path ${path} appears twice` };
      seen.add(path);
      sections.push({ path, lines: [] });
      continue;
    }
    const current = sections[sections.length - 1];
    if (current) current.lines.push(line);
    else if (line.trim() !== "") stray = true;
  }

  if (fence !== null) {
    const opened = sections[sections.length - 1]?.path ?? "the start";
    return { ok: false, error: `unclosed code fence in bundle section ${opened}` };
  }

  if (sections.length === 0) return { ok: false, error: "empty bundle: no pm:file markers" };

  const files: BundleFile[] = [];
  for (const s of sections) {
    const body = trimBlankEdges(s.lines);
    if (body.length === 0) return { ok: false, error: `bundle section ${s.path} is empty` };
    files.push({ path: s.path, content: `${body.join("\n")}\n` });
  }
  return { ok: true, files };
}
