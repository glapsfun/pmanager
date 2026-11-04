import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatFmValue, getString, parseDoc } from "./contract";
import { git, repoRoot } from "./git";
import { LOCAL_REPOS_FILE, loadLocalRepoMap, readLocalRepoMap, repoMapPmDir } from "./handoff";
import { repoShortName } from "./render";
import { LOCAL_DIR, PROJECTS_DIR } from "./repo";
import { lookupMapped, normalizeRepoUrl, sameRepo } from "./repo-url";
import { listWorktrees } from "./worktree";

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

export type Availability =
  | { state: "available"; path: string }
  | { state: "not mapped" }
  | { state: "missing"; path: string }
  | { state: "origin mismatch"; path: string; origin: string };

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function originOf(dir: string): Promise<string | null> {
  const r = await git(["remote", "get-url", "origin"], dir);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Whether this machine has the project checked out, and checked out from the right repo. */
export async function availability(p: Project, map: Record<string, string>): Promise<Availability> {
  const path = lookupMapped(map, p.url);
  if (path === undefined) return { state: "not mapped" };
  if (!(await isDirectory(path))) return { state: "missing", path };
  const origin = await originOf(path);
  // A folder name is not identity: only the checkout's own origin proves which repo it is.
  if (origin === null || !sameRepo(origin, p.url)) {
    return { state: "origin mismatch", path, origin: origin ?? "none" };
  }
  return { state: "available", path };
}

export function formatAvailability(a: Availability): string {
  if (a.state === "missing") return `missing ${a.path}`;
  if (a.state === "origin mismatch") return `origin mismatch ${a.origin}`;
  return a.state;
}

const ID = /^[a-z0-9][a-z0-9._-]*$/;

export function defaultProjectId(url: string): string {
  return (normalizeRepoUrl(url).split("/").pop() ?? url).toLowerCase();
}

export type AddOutcome =
  | { ok: true; project: Project; created: boolean; mapped: string | null; written: string[] }
  | { ok: false; message: string };

/** The main checkout and its worktrees: the manager is never its own target. */
async function managerCheckouts(mainRoot: string): Promise<Set<string>> {
  const paths = [mainRoot, ...(await listWorktrees(mainRoot)).map((w) => w.path)];
  return new Set(await Promise.all(paths.map((p) => realpath(p).catch(() => p))));
}

/**
 * Registers a project by checkout path or URL in the main checkout's catalog and
 * maps a given checkout in repos.json. Writes files; commits nothing.
 */
export async function addProject(
  root: string,
  arg: string,
  opts: { id?: string; name?: string; today: string },
): Promise<AddOutcome> {
  const pmDir = await repoMapPmDir(root);
  const mainRoot = dirname(dirname(pmDir));
  let url = arg;
  let path: string | null = null;
  if (await isDirectory(arg)) {
    const top = await repoRoot(arg);
    if (!top) return { ok: false, message: `${arg} is not inside a git repository` };
    if ((await managerCheckouts(mainRoot)).has(await realpath(top))) {
      return { ok: false, message: `${top} is this manager repo; register the repos it plans for` };
    }
    const origin = await originOf(top);
    if (origin === null) {
      return { ok: false, message: `${top} has no origin remote; add one, or register by URL` };
    }
    url = origin;
    path = top;
  }

  const catalog = await loadCatalog(pmDir);
  let project = catalog.projects.find((p) => sameRepo(p.url, url));
  const written: string[] = [];
  const created = project === undefined;
  if (!project) {
    const id = opts.id ?? defaultProjectId(url);
    if (!ID.test(id)) return { ok: false, message: `invalid project id ${id}; pass --id` };
    const taken = catalog.projects.find((p) => p.id === id);
    if (taken) {
      return {
        ok: false,
        message: `id ${id} is taken by ${taken.url}; pass --id to name this one`,
      };
    }
    const dir = join(pmDir, PROJECTS_DIR);
    project = { id, name: opts.name ?? id, url, added: opts.today, file: join(dir, `${id}.md`) };
    await mkdir(dir, { recursive: true });
    await writeFile(project.file, projectFileText(project));
    const index = join(dir, PROJECTS_INDEX);
    await writeFile(index, renderProjectsIndex([...catalog.projects, project]));
    written.push(project.file, index);
  }

  if (path !== null) {
    const map = await loadLocalRepoMap(pmDir);
    const key = Object.keys(map).find((k) => sameRepo(k, url)) ?? project.url;
    map[key] = path;
    await writeFile(join(pmDir, LOCAL_DIR, LOCAL_REPOS_FILE), `${JSON.stringify(map, null, 2)}\n`);
  }
  return { ok: true, project, created, mapped: path, written };
}

export interface Candidate {
  path: string;
  origin: string | null;
  suggestedId: string;
  state: "new" | "registered" | "another checkout" | "no origin";
  id?: string;
}

async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Git repos beside the main checkout, as registration suggestions. Reads only
 * each sibling's origin; registers nothing and writes nothing.
 */
export async function discoverSiblings(root: string): Promise<Candidate[]> {
  const pmDir = await repoMapPmDir(root);
  const mainRoot = dirname(dirname(pmDir));
  const parent = dirname(mainRoot);
  const [skip, managerOrigin, catalog, map] = await Promise.all([
    managerCheckouts(mainRoot),
    originOf(mainRoot),
    loadCatalog(pmDir),
    readLocalRepoMap(pmDir),
  ]);
  const real = (p: string) => realpath(p).catch(() => p);
  const out: Candidate[] = [];
  const entries = (await readdir(parent, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of entries) {
    const path = join(parent, name);
    if (!(await hasGitEntry(path)) || skip.has(await real(path))) continue;
    const origin = await originOf(path);
    // Another clone of the manager is still the manager, never a target.
    if (origin !== null && managerOrigin !== null && sameRepo(origin, managerOrigin)) continue;
    if (origin === null) {
      out.push({ path, origin, suggestedId: name.toLowerCase(), state: "no origin" });
      continue;
    }
    const suggestedId = defaultProjectId(origin);
    const project = catalog.projects.find((p) => sameRepo(p.url, origin));
    if (!project) {
      out.push({ path, origin, suggestedId, state: "new" });
      continue;
    }
    const mapped = lookupMapped(map, project.url);
    const here = mapped !== undefined && (await real(mapped)) === (await real(path));
    out.push({
      path,
      origin,
      suggestedId,
      state: here ? "registered" : "another checkout",
      id: project.id,
    });
  }
  return out;
}

export function formatCandidate(c: Candidate): string {
  const state =
    c.state === "registered"
      ? `registered as ${c.id}`
      : c.state === "another checkout"
        ? `another checkout of ${c.id}`
        : c.state;
  return `${c.path}  ${c.origin ?? "-"}  ${state}`;
}
