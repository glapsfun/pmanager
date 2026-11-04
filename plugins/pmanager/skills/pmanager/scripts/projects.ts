import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatFmValue, getString, parseDoc } from "./contract";
import { repoShortName } from "./render";
import { PROJECTS_DIR } from "./repo";

export { PROJECTS_DIR } from "./repo";
export { lookupMapped, normalizeRepoUrl, sameRepo } from "./repo-url";

export const PROJECTS_INDEX = "INDEX.md";

export interface Project {
  id: string;
  name: string;
  url: string;
  added: string;
  file: string;
}

export interface Catalog {
  projects: Project[];
  invalid: { file: string; reason: string }[];
  index: string | null;
}

export function projectFileText(p: Omit<Project, "file">): string {
  const fm = [
    formatFmValue("id", p.id),
    formatFmValue("name", p.name),
    formatFmValue("url", p.url),
    formatFmValue("added", p.added),
    "contract: 1\n",
  ].join("");
  // Notes belong to the user; later catalog parts add generated sections beside them.
  return `---\n${fm}---\n\n# ${p.name}\n\n## Notes\n\nnone\n`;
}

/** The catalog in `<pmDir>/projects/`; a broken file is reported, never fatal. */
export async function loadCatalog(pmDir: string): Promise<Catalog> {
  const dir = join(pmDir, PROJECTS_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return { projects: [], invalid: [], index: null };
  }
  const projects: Project[] = [];
  const invalid: Catalog["invalid"] = [];
  let index: string | null = null;
  for (const name of names) {
    const file = join(dir, name);
    const raw = await readFile(file, "utf8");
    if (name === PROJECTS_INDEX) {
      index = raw;
      continue;
    }
    const fm = parseDoc(file, raw).frontmatter;
    const id = getString(fm, "id");
    const title = getString(fm, "name");
    const url = getString(fm, "url");
    const missing = [!id && "id", !title && "name", !url && "url"].filter(Boolean);
    if (!id || !title || !url) {
      invalid.push({ file, reason: `missing ${missing.join(", ")}` });
      continue;
    }
    if (`${id}.md` !== name) {
      invalid.push({ file, reason: `id ${id} does not match the file name` });
      continue;
    }
    projects.push({ id, name: title, url, added: getString(fm, "added") ?? "", file });
  }
  return { projects, invalid, index };
}

const cell = (s: string) => s.replaceAll("|", "\\|");

export function renderProjectsIndex(projects: Project[]): string {
  const rows = [...projects]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (p) =>
        `| [${p.id}](${p.id}.md) | ${cell(p.name)} | ${cell(repoShortName(p.url))} | ${p.added} |`,
    );
  return [
    "# Projects",
    "",
    "Rendered from the project files in this folder by `pm render`; never edit by hand.",
    "",
    "| Project | Name | Repo | Added |",
    "| :--- | :--- | :--- | :--- |",
    ...rows,
    "",
  ].join("\n");
}
