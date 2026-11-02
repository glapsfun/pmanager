import { join } from "node:path";

export interface Config {
  root: string;
  slug: string;
  originPattern: RegExp;
  base: string;
  manifests: readonly string[];
  marketplace: string;
  shipped: readonly string[];
  pluginDir: string;
  stateDir: string;
  requiredChecks: readonly string[];
}

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

export function defaultConfig(root: string = REPO_ROOT): Config {
  return {
    root,
    slug: "glapsfun/pmanager",
    originPattern: /github\.com[:/]glapsfun\/pmanager(\.git)?$/,
    base: "main",
    manifests: [
      "plugins/pmanager/.claude-plugin/plugin.json",
      "plugins/pmanager/.codex-plugin/plugin.json",
    ],
    marketplace: ".claude-plugin/marketplace.json",
    shipped: ["plugins/pmanager", ".claude-plugin/marketplace.json"],
    pluginDir: "plugins/pmanager",
    stateDir: ".release-guru",
    requiredChecks: ["lint", "typecheck", "test", "manifest", "audit", "e2e", "commits"],
  };
}
