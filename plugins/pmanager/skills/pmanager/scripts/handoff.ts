import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { getList, getString, sectionBody } from "./contract";
import { epicBySlug, LOCAL_DIR, type PmRepo, taskById } from "./repo";

export const LOCAL_REPOS_FILE = "repos.json";

export async function loadLocalRepoMap(pmDir: string): Promise<Record<string, string>> {
  const dir = join(pmDir, LOCAL_DIR);
  const file = join(dir, LOCAL_REPOS_FILE);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    await mkdir(dir, { recursive: true });
    await writeFile(file, "{}\n");
    await writeFile(join(dir, ".gitignore"), "*\n");
    return {};
  }
}

export function resolveRepo(url: string, map: Record<string, string>): string | null {
  return map[url] ?? null;
}

function trimmed(body: string, heading: string): string {
  return (sectionBody(body, heading) ?? "").trim() || "(empty)";
}

export function buildHandoff(
  repo: PmRepo,
  slug: string,
  taskId: string,
  map: Record<string, string>,
): string {
  const epic = epicBySlug(repo, slug);
  if (!epic || !epic.epic) throw new Error(`unknown epic ${slug}`);
  const task = taskById(epic, taskId);
  if (!task) throw new Error(`unknown task ${taskId} in ${slug}`);
  const efm = epic.epic.frontmatter;
  const tfm = task.frontmatter;
  const repos = getList(efm, "repos");
  const repoLines =
    repos.length === 0
      ? ["- none declared in epic frontmatter"]
      : repos.map((u) => {
          const local = resolveRepo(u, map);
          return local
            ? `- ${u} → ${local}`
            : `- ${u} → not checked out on this machine; map it in docs/pm/.local/repos.json`;
        });
  const taskRel = relative(repo.root, task.path);
  return [
    `# Handoff — ${getString(efm, "title") ?? slug} / ${task.id} — ${getString(tfm, "title") ?? task.id}`,
    "",
    "## Epic",
    "",
    trimmed(epic.epic.body, "Problem statement"),
    "",
    "## Target repositories",
    "",
    ...repoLines,
    "",
    `## Task file: ${taskRel}`,
    "",
    task.raw.trimEnd(),
    "",
    "## Acceptance criteria",
    "",
    trimmed(task.body, "Acceptance criteria"),
    "",
    "## Out of scope",
    "",
    trimmed(task.body, "Out of scope"),
    "",
    "## Report back",
    "",
    `When finished, tell the planning session exactly: "${task.id} of ${slug} is done, evidence at <path>"`,
    `If blocked: "${task.id} of ${slug} is blocked on <reason>"`,
    "",
  ].join("\n");
}
