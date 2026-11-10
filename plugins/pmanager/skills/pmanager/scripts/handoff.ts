import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { getList, getString, sectionBody } from "./contract";
import { git } from "./git";
import { type Command, type Profile, type Role, resolvePart } from "./profile";
import { epicBySlug, LOCAL_DIR, PM_DIR, type PmRepo, taskById } from "./repo";
import { lookupMapped } from "./repo-url";

export const LOCAL_REPOS_FILE = "repos.json";

/**
 * The docs/pm whose .local holds the repo map. The map is per machine and
 * gitignored, so an epic worktree has none of its own; it shares the main
 * checkout's. Bare repos and separate git dirs keep the checkout's own.
 */
export async function repoMapPmDir(root: string): Promise<string> {
  const r = await git(["rev-parse", "--git-common-dir"], root);
  const common = r.code === 0 ? resolve(root, r.stdout.trim()) : "";
  return basename(common) === ".git" ? join(dirname(common), PM_DIR) : join(root, PM_DIR);
}

export function parseLocalRepoMap(text: string): Record<string, string> {
  const parsed = JSON.parse(text) as unknown;
  const out: Record<string, string> = {};
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/** The map without side effects; research must not create .local on a read. */
export async function readLocalRepoMap(pmDir: string): Promise<Record<string, string>> {
  try {
    return parseLocalRepoMap(await readFile(join(pmDir, LOCAL_DIR, LOCAL_REPOS_FILE), "utf8"));
  } catch {
    return {};
  }
}

export async function loadLocalRepoMap(pmDir: string): Promise<Record<string, string>> {
  const dir = join(pmDir, LOCAL_DIR);
  const file = join(dir, LOCAL_REPOS_FILE);
  try {
    return parseLocalRepoMap(await readFile(file, "utf8"));
  } catch {
    await mkdir(dir, { recursive: true });
    await writeFile(file, "{}\n");
    await writeFile(join(dir, ".gitignore"), "*\n");
    return {};
  }
}

export function resolveRepo(url: string, map: Record<string, string>): string | null {
  return lookupMapped(map, url) ?? null;
}

function trimmed(body: string, heading: string): string {
  return (sectionBody(body, heading) ?? "").trim() || "(empty)";
}

function partLines(ids: string[], profiles: Map<string, Profile>): string[] {
  const out: string[] = [];
  const quote = (cs: Command[]) => cs.map((c) => `\`${c.text}\` (${c.source})`).join("; ");
  for (const id of ids) {
    const hit = resolvePart(id, profiles);
    if (!hit) {
      out.push(`- \`${id}\`: no such part in a stored profile; check the id with pm research`);
      continue;
    }
    out.push(`- \`${id}\``);
    const roles: [Role, string][] = [
      ["check", "checks"],
      ["release", "releases with"],
      ["deploy", "deploys with"],
      ["forbidden", "do not run"],
    ];
    for (const [role, label] of roles) {
      const cs = hit.part.commands.filter((c) => c.role === role);
      if (cs.length > 0) out.push(`  - ${label}: ${quote(cs)}`);
    }
    for (const l of profiles.get(hit.project)?.links ?? []) {
      if (l.source.folder !== hit.part.folder && l.consumer.folder !== hit.part.folder) continue;
      const kind = l.release ? "release link" : "link";
      out.push(
        `  - ${kind}: ${l.consumer.file} ${l.consumer.key} follows ${l.source.file} ${l.source.key} (\`${l.value}\`)`,
      );
    }
  }
  return out;
}

export function buildHandoff(
  repo: PmRepo,
  slug: string,
  taskId: string,
  map: Record<string, string>,
  profiles: Map<string, Profile> = new Map(),
): string {
  const epic = epicBySlug(repo, slug);
  if (!epic?.epic) throw new Error(`unknown epic ${slug}`);
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
  const parts = getList(tfm, "parts");
  const partSection =
    parts.length === 0
      ? []
      : ["## Checks for this task's parts", "", ...partLines(parts, profiles), ""];
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
    ...partSection,
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
    `When finished, tell the planning session exactly: "${task.id} of ${slug} is done, evidence at <path>"; after a failed attempt, end it with "; fixed by <what changed>"`,
    `If an attempt failed: "${task.id} of ${slug} attempt failed: tried <what>; got <result>; evidence at <path>"`,
    `If blocked: "${task.id} of ${slug} is blocked on <reason>"`,
    "Keep each field to a short summary and point at evidence by path or URL; never paste log output.",
    "",
  ].join("\n");
}
