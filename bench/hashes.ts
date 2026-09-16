import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { SKILL_DIR } from "./skill-paths";

export const SKILL_SKIP = new Set(["node_modules", "bun.lock", ".git"]);
export const FIXTURE_SKIP = new Set([".git", ".agents", ".claude"]);

export function hashString(s: string): string {
  return `sha256:${createHash("sha256").update(s).digest("hex")}`;
}

async function walk(root: string, dir: string, skip: Set<string>, out: string[]): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(root, p, skip, out);
    else if (e.isFile()) out.push(relative(root, p));
  }
}

export async function hashTree(dir: string, skip: Set<string>): Promise<string> {
  const files: string[] = [];
  await walk(dir, dir, skip, files);
  files.sort();
  const h = createHash("sha256");
  for (const rel of files) {
    h.update(rel)
      .update("\0")
      .update(await readFile(join(dir, rel)))
      .update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}

export function hashSkill(): Promise<string> {
  return hashTree(SKILL_DIR, SKILL_SKIP);
}

export function hashFixture(dir: string): Promise<string> {
  return hashTree(dir, FIXTURE_SKIP);
}
