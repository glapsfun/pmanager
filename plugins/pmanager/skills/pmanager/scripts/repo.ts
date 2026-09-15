import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getString, type ParsedDoc, parseDoc } from "./contract";
import { parseLogEntry } from "./log";

export const PM_DIR = "docs/pm";
export const LOG_DIR = "log";
export const LOCAL_DIR = ".local";

export interface TaskDoc extends ParsedDoc {
  id: string;
}

export interface EpicRecord {
  slug: string;
  dir: string;
  epic: ParsedDoc | null;
  plan: ParsedDoc | null;
  tasks: TaskDoc[];
}

export interface LogEntry {
  path: string;
  date: string;
  epic: string;
  harness: string;
  kind: string;
  message: string;
}

export interface PmRepo {
  root: string;
  pmDir: string;
  epics: EpicRecord[];
  index: string | null;
  memo: { path: string; raw: string } | null;
  logs: LogEntry[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(p: string): Promise<string | null> {
  return (await exists(p)) ? readFile(p, "utf8") : null;
}

async function readDoc(p: string): Promise<ParsedDoc | null> {
  const raw = await readOptional(p);
  return raw === null ? null : parseDoc(p, raw);
}

async function loadEpic(pmDir: string, slug: string): Promise<EpicRecord> {
  const dir = join(pmDir, slug);
  const epic = await readDoc(join(dir, "epic.md"));
  const plan = await readDoc(join(dir, "plan.md"));
  const tasks: TaskDoc[] = [];
  const tasksDir = join(dir, "tasks");
  if (await exists(tasksDir)) {
    const names = (await readdir(tasksDir)).filter((n) => n.endsWith(".md")).sort();
    for (const name of names) {
      const p = join(tasksDir, name);
      const doc = parseDoc(p, await readFile(p, "utf8"));
      tasks.push({
        ...doc,
        id: getString(doc.frontmatter, "id") ?? name.split("-")[0] ?? name,
      });
    }
  }
  return { slug, dir, epic, plan, tasks };
}

export async function loadPmRepo(root: string): Promise<PmRepo> {
  const pmDir = join(root, PM_DIR);
  if (!(await exists(pmDir))) throw new Error("no docs/pm directory");
  const entries = await readdir(pmDir, { withFileTypes: true });
  const epics: EpicRecord[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === LOG_DIR || e.name.startsWith(".")) continue;
    epics.push(await loadEpic(pmDir, e.name));
  }
  epics.sort((a, b) => a.slug.localeCompare(b.slug));
  const logs: LogEntry[] = [];
  const logDir = join(pmDir, LOG_DIR);
  if (await exists(logDir)) {
    for (const name of (await readdir(logDir)).filter((n) => n.endsWith(".md")).sort()) {
      const p = join(logDir, name);
      logs.push(parseLogEntry(p, await readFile(p, "utf8")));
    }
  }
  const memoPath = join(pmDir, "pmanager-memo.md");
  const memoRaw = await readOptional(memoPath);
  return {
    root,
    pmDir,
    epics,
    index: await readOptional(join(pmDir, "INDEX.md")),
    memo: memoRaw === null ? null : { path: memoPath, raw: memoRaw },
    logs,
  };
}

export function epicBySlug(repo: PmRepo, slug: string): EpicRecord | undefined {
  return repo.epics.find((e) => e.slug === slug);
}

export function taskById(epic: EpicRecord, id: string): TaskDoc | undefined {
  return epic.tasks.find((t) => t.id === id);
}

export function epicId(rec: EpicRecord): string {
  return (rec.epic && getString(rec.epic.frontmatter, "id")) || rec.slug;
}
