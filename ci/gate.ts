import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditCheck } from "./checks/audit";
import { commitMsgCheck, commitsCheck } from "./checks/commit-msg";
import { testCheck } from "./checks/coverage";
import { manifestCheck } from "./checks/manifest";
import { lintStagedCheck } from "./checks/staged";
import { missingInstall, PACKAGES, REPO_ROOT } from "./packages";
import { sh } from "./proc";
import { type CheckName, STAGES, type StageName } from "./stages";

export interface Ctx {
  root: string;
  ci: boolean;
  args: string[];
}

export type Check = (ctx: Ctx) => Promise<boolean>;

const CHECK_NAMES: readonly CheckName[] = [
  "lint",
  "lint-staged",
  "typecheck",
  "test",
  "manifest",
  "audit",
  "e2e",
  "commit-msg",
  "commits",
];

/** Checks that run without node_modules installed. */
const NO_INSTALL: readonly CheckName[] = ["commit-msg", "commits"];

/** Runs a bun script in every package; true when all exit 0. */
async function eachPackage(ctx: Ctx, script: string): Promise<boolean> {
  let ok = true;
  for (const p of PACKAGES) {
    if ((await sh(["bun", "run", script], join(ctx.root, p.dir))) !== 0) ok = false;
  }
  return ok;
}

/** Registry of implemented checks; later tasks add entries. */
export const CHECKS: Partial<Record<CheckName, Check>> = {
  lint: (ctx) => eachPackage(ctx, "lint"),
  "lint-staged": lintStagedCheck,
  typecheck: (ctx) => eachPackage(ctx, "typecheck"),
  test: testCheck,
  manifest: manifestCheck,
  audit: auditCheck,
  e2e: (ctx) =>
    sh(["bun", "test", "./e2e", "--timeout", "60000"], join(ctx.root, "ci")).then((c) => c === 0),
  "commit-msg": commitMsgCheck,
  commits: commitsCheck,
};

/** Runs checks in order, stopping at the first failure. Returns the exit code. */
export async function runChecks(
  names: CheckName[],
  ctx: Ctx,
  deps: { missingInstall?: typeof missingInstall; err?: (s: string) => void } = {},
): Promise<number> {
  const err = deps.err ?? ((s: string) => console.error(s));
  const needsInstall = names.some((n) => !NO_INSTALL.includes(n));
  const missing = needsInstall
    ? await (deps.missingInstall ?? missingInstall)(ctx.root, PACKAGES)
    : [];
  if (missing.length > 0) {
    err(`missing node_modules in: ${missing.join(", ")}`);
    err("run: bun run setup");
    return 2;
  }
  for (const name of names) {
    const check = CHECKS[name];
    if (!check) {
      err(`check not implemented: ${name}`);
      return 2;
    }
    console.log(`▶ ${name}`);
    const start = performance.now();
    if (!(await check(ctx))) {
      console.log(`✖ ${name}`);
      return 1;
    }
    console.log(`✔ ${name} (${((performance.now() - start) / 1000).toFixed(1)}s)`);
  }
  return 0;
}

/** Installs dependencies in every package from the lockfiles. */
async function install(root: string): Promise<number> {
  for (const p of PACKAGES) {
    const code = await sh(["bun", "install", "--frozen-lockfile"], join(root, p.dir));
    if (code !== 0) return 1;
  }
  return 0;
}

function warnBunVersion(root: string): void {
  const file = join(root, ".bun-version");
  if (!existsSync(file)) return;
  const pinned = readFileSync(file, "utf8").trim();
  if (pinned && Bun.version !== pinned) {
    console.error(`bun ${Bun.version} differs from .bun-version ${pinned}; CI uses ${pinned}`);
  }
}

function usage(): number {
  const names = [...Object.keys(STAGES), ...CHECK_NAMES, "install", "setup"];
  console.error(`usage: bun ci/gate.ts <${names.join("|")}> [args]`);
  return 2;
}

/** CLI entry: dispatches a check, stage, install or setup. */
export async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;
  const ctx: Ctx = { root: REPO_ROOT, ci: process.env.CI === "true", args };
  if (name === "install" || name === "setup") {
    warnBunVersion(ctx.root);
    if ((await install(ctx.root)) !== 0) return 1;
    if (name === "install") return 0;
    return (await sh(["git", "config", "core.hooksPath", "ci/hooks"], ctx.root)) === 0 ? 0 : 1;
  }
  if (name && name in STAGES) {
    warnBunVersion(ctx.root);
    return runChecks(STAGES[name as StageName], ctx);
  }
  if (name && (CHECK_NAMES as readonly string[]).includes(name)) {
    warnBunVersion(ctx.root);
    return runChecks([name as CheckName], ctx);
  }
  return usage();
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
