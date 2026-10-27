export interface BundleFile {
  path: string;
  content: string;
}

export type BundleResult = { ok: true; files: BundleFile[] } | { ok: false; error: string };

const MARKER = /^<!-- pm:file (.+?) -->\s*$/;
const FENCE = /^(```|~~~)/;

function pathError(path: string, slug: string): string | null {
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
  let fence: string | null = null;
  let stray = false;

  for (const line of lines) {
    const fenceMark = FENCE.exec(line)?.[1] ?? null;
    if (fenceMark) {
      if (fence === null) fence = fenceMark;
      else if (fence === fenceMark) fence = null;
    }
    const path = fence === null && !fenceMark ? MARKER.exec(line)?.[1] : undefined;
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
