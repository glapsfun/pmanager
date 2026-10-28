import { join } from "node:path";
import type { Ctx } from "../gate";
import { PACKAGES, type PackageName, type Pkg } from "../packages";
import { capture, sh } from "../proc";

/** Groups repo-relative paths by package, as package-relative paths; others are dropped. */
export function stagedByPackage(paths: string[], pkgs: readonly Pkg[]): Map<PackageName, string[]> {
  const out = new Map<PackageName, string[]>();
  for (const path of paths) {
    const pkg = pkgs.find((p) => path.startsWith(`${p.dir}/`));
    if (!pkg) continue;
    const list = out.get(pkg.name) ?? [];
    list.push(path.slice(pkg.dir.length + 1));
    out.set(pkg.name, list);
  }
  return out;
}

export interface StagedDeps {
  capture: typeof capture;
  sh: typeof sh;
}

/** Runs biome on staged files only, per package; spawns nothing when none are in a package. */
export async function lintStagedCheck(
  ctx: Ctx,
  deps: StagedDeps = { capture, sh },
): Promise<boolean> {
  const { code, stdout } = await deps.capture(
    ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    ctx.root,
  );
  if (code !== 0) return false;
  const staged = stagedByPackage(stdout.split("\n").filter(Boolean), PACKAGES);
  let ok = true;
  for (const [name, files] of staged) {
    const pkg = PACKAGES.find((p) => p.name === name) as Pkg;
    const cmd = ["bunx", "biome", "check", "--no-errors-on-unmatched", ...files];
    if ((await deps.sh(cmd, join(ctx.root, pkg.dir))) !== 0) ok = false;
  }
  return ok;
}
