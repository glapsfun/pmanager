import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type PackageName = "tool" | "bench" | "ci";

export interface Pkg {
  name: PackageName;
  dir: string;
}

export const REPO_ROOT = dirname(import.meta.dir);

export const PACKAGES: readonly Pkg[] = [
  { name: "tool", dir: "plugins/pmanager/skills/pmanager" },
  { name: "bench", dir: "bench" },
  { name: "ci", dir: "ci" },
];

/** Names of packages whose directory has no node_modules. */
export async function missingInstall(root: string, pkgs: readonly Pkg[]): Promise<PackageName[]> {
  return pkgs.filter((p) => !existsSync(join(root, p.dir, "node_modules"))).map((p) => p.name);
}
