import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Check } from "../gate";
import { capture, sh } from "../proc";
import VERSIONS from "../tool-versions.json";

export interface ManifestInput {
  claude: { name?: string; version?: string };
  codex: { name?: string; version?: string; skills?: string };
  marketplace: { plugins?: { name: string; source: string; version?: string }[] };
  sourceExists: (source: string) => boolean;
  /** Names of the `<name>/SKILL.md` skills in a plugin-relative directory; [] when it is not a directory. */
  skillsIn: (dir: string) => string[];
}

/** Names of the subdirectories of dir that hold a SKILL.md; [] when dir is not a directory. */
export function skillNames(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => e.name);
}

/** Cross-file consistency problems between the plugin manifests and the marketplace. */
export function manifestProblems(m: ManifestInput): string[] {
  const out: string[] = [];
  if (m.claude.name !== m.codex.name) {
    out.push(`name differs: claude ${m.claude.name} vs codex ${m.codex.name}`);
  }
  if (m.claude.version !== m.codex.version) {
    out.push(`version differs: claude ${m.claude.version} vs codex ${m.codex.version}`);
  }
  if (!m.codex.skills) out.push("codex plugin.json has no skills path");
  else if (m.skillsIn(m.codex.skills).length === 0) {
    out.push(`codex skills path ${m.codex.skills} has no <name>/SKILL.md`);
  }
  const entry = m.marketplace.plugins?.find((p) => p.name === m.claude.name);
  if (!entry) {
    out.push(`marketplace has no entry named ${m.claude.name}`);
    return out;
  }
  if (!m.sourceExists(entry.source)) out.push(`marketplace source ${entry.source} does not exist`);
  if (entry.version !== undefined && entry.version !== m.claude.version) {
    out.push(`marketplace version ${entry.version} differs from plugin ${m.claude.version}`);
  }
  return out;
}

const PLUGIN_DIR = "plugins/pmanager";

const readJson = <T>(root: string, file: string): T =>
  JSON.parse(readFileSync(join(root, file), "utf8")) as T;

/** Checks manifest sync, then runs `claude plugin validate` on the plugin and the marketplace. */
export const manifestCheck: Check = async (ctx) => {
  const problems = manifestProblems({
    claude: readJson(ctx.root, `${PLUGIN_DIR}/.claude-plugin/plugin.json`),
    codex: readJson(ctx.root, `${PLUGIN_DIR}/.codex-plugin/plugin.json`),
    marketplace: readJson(ctx.root, ".claude-plugin/marketplace.json"),
    sourceExists: (source) => existsSync(join(ctx.root, source)),
    skillsIn: (dir) => skillNames(join(ctx.root, PLUGIN_DIR, dir)),
  });
  for (const p of problems) console.error(`manifest: ${p}`);
  if (problems.length > 0) return false;

  const probe = await capture(["claude", "--version"], ctx.root).catch(() => null);
  if (probe?.code !== 0) {
    console.error(
      `claude CLI not found: npm install -g @anthropic-ai/claude-code@${VERSIONS["claude-code"]}`,
    );
    return false;
  }
  let ok = true;
  for (const target of [PLUGIN_DIR, "."]) {
    if ((await sh(["claude", "plugin", "validate", target], ctx.root)) !== 0) ok = false;
  }
  return ok;
};
