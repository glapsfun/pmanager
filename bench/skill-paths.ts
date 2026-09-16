import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..");
export const SKILL_DIR = join(REPO_ROOT, "plugins", "pmanager", "skills", "pmanager");
export const PLUGIN_MANIFEST = join(
  REPO_ROOT,
  "plugins",
  "pmanager",
  ".claude-plugin",
  "plugin.json",
);
export const BENCH_DIR = import.meta.dir;
export const HISTORY_PATH = join(BENCH_DIR, "results", "history.jsonl");
export const RAW_DIR = join(BENCH_DIR, "results", "raw");
export const REPORT_PATH = join(BENCH_DIR, "BENCH.md");
export const README_PATH = join(REPO_ROOT, "README.md");
export const EXPERIMENTS_DIR = join(BENCH_DIR, "experiments");
export const PM_TODAY = "2026-09-15";

export async function readSkillVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(PLUGIN_MANIFEST, "utf8")) as { version?: string };
  return manifest.version ?? "unknown";
}
