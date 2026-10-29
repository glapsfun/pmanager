import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/** Repo-relative paths added, copied, modified or renamed in the index; null when git fails. */
export async function stagedFiles(
  ctx: Ctx,
  run: typeof capture = capture,
): Promise<string[] | null> {
  const { code, stdout, stderr } = await run(
    ["git", "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    ctx.root,
    ctx.gitEnv,
  );
  if (code !== 0) {
    console.error(`lint-staged: git diff --cached failed: ${stderr.trim()}`);
    return null;
  }
  return stdout.split("\0").filter(Boolean);
}

/** Runs biome per package on the staged content of staged files, not the working-tree copies. */
export async function lintStagedCheck(
  ctx: Ctx,
  deps: StagedDeps = { capture, sh },
): Promise<boolean> {
  const files = await stagedFiles(ctx, deps.capture);
  if (!files) return false;
  const staged = stagedByPackage(files, PACKAGES);
  if (staged.size === 0) return true;
  const snapshot = await mkdtemp(join(tmpdir(), "lint-staged-"));
  try {
    let ok = true;
    for (const [name, rel] of staged) {
      const pkg = PACKAGES.find((p) => p.name === name) as Pkg;
      const paths = new Set([`${pkg.dir}/biome.json`, ...rel.map((f) => `${pkg.dir}/${f}`)]);
      const out = await deps.capture(
        ["git", "checkout-index", `--prefix=${snapshot}/`, "--", ...paths],
        ctx.root,
        ctx.gitEnv,
      );
      if (out.code !== 0) {
        console.error(`lint-staged: git checkout-index failed: ${out.stderr.trim()}`);
        return false;
      }
      const dir = join(snapshot, pkg.dir);
      await mkdir(dir, { recursive: true });
      await symlink(join(ctx.root, pkg.dir, "node_modules"), join(dir, "node_modules"), "dir");
      const cmd = ["bunx", "biome", "check", "--no-errors-on-unmatched", ...rel];
      if ((await deps.sh(cmd, dir)) !== 0) ok = false;
    }
    return ok;
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}
