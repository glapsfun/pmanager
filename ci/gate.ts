import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGitEnv } from "../plugins/pmanager/skills/pmanager/tests/git-env";
import { auditCheck } from "./checks/audit";
import { commitMsgCheck, commitsCheck } from "./checks/commit-msg";
import { testCheck } from "./checks/coverage";
import { manifestCheck } from "./checks/manifest";
import { lintStagedCheck } from "./checks/staged";
import { missingInstall, PACKAGES, REPO_ROOT } from "./packages";
import { prePushGuard } from "./pre-push";
import { capture, sh } from "./proc";
import { type CheckName, STAGES, type StageName } from "./stages";
import toolVersions from "./tool-versions.json";

export interface Ctx {
  root: string;
  ci: boolean;
  args: string[];
  /** The hook's own git env, cleared from process.env; only lint-staged reads it. */
  gitEnv?: Record<string, string>;
}

export type Check = (ctx: Ctx) => Promise<boolean>;

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

/** Runs the free e2e suite in ci/e2e. */
export async function e2eCheck(ctx: Ctx, run: typeof sh = sh): Promise<boolean> {
  return (await run(["bun", "test", "./e2e", "--timeout", "60000"], join(ctx.root, "ci"))) === 0;
}

/** Every check, by name. */
export const CHECKS: Record<CheckName, Check> = {
  lint: (ctx) => eachPackage(ctx, "lint"),
  "lint-staged": lintStagedCheck,
  typecheck: (ctx) => eachPackage(ctx, "typecheck"),
  test: testCheck,
  manifest: manifestCheck,
  audit: auditCheck,
  e2e: e2eCheck,
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
    console.log(`▶ ${name}`);
    const start = performance.now();
    if (!(await CHECKS[name](ctx))) {
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
  const names = [
    ...Object.keys(STAGES),
    ...Object.keys(CHECKS),
    "install",
    "install-clis",
    "setup",
  ];
  console.error(`usage: bun ci/gate.ts <${names.join("|")}> [args]`);
  return 2;
}

/** The npm command that installs the pinned agent CLIs globally. */
export function installClisCommand(
  v: { "claude-code": string; codex: string } = toolVersions,
): string[] {
  return [
    "npm",
    "install",
    "-g",
    `@anthropic-ai/claude-code@${v["claude-code"]}`,
    `@openai/codex@${v.codex}`,
  ];
}

export interface MainDeps {
  run?: (cmd: string[], cwd: string) => Promise<number>;
  root?: string;
  stdin?: () => Promise<string>;
  runChecks?: (names: CheckName[], ctx: Ctx) => Promise<number>;
}

/** CLI entry: dispatches a check, stage, install or setup. */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const gitEnv = clearGitEnv();
  const [name, ...args] = argv;
  const ctx: Ctx = { root: deps.root ?? REPO_ROOT, ci: process.env.CI === "true", args, gitEnv };
  const checks = deps.runChecks ?? runChecks;
  if (name === "install" || name === "setup") {
    warnBunVersion(ctx.root);
    if ((await install(ctx.root)) !== 0) return 1;
    if (name === "install") return 0;
    return (await sh(["git", "config", "core.hooksPath", "ci/hooks"], ctx.root)) === 0 ? 0 : 1;
  }
  if (name === "install-clis") {
    return (deps.run ?? sh)(installClisCommand(), ctx.root);
  }
  if (name === "pre-push") {
    warnBunVersion(ctx.root);
    const stdin =
      args[0] === "--hook" ? await (deps.stdin ?? (() => Bun.stdin.text()))() : undefined;
    if (!(await prePushGuard((a) => capture(["git", ...a], ctx.root), stdin))) return 1;
    return checks(STAGES["pre-push"], ctx);
  }
  if (name && Object.hasOwn(STAGES, name)) {
    warnBunVersion(ctx.root);
    return checks(STAGES[name as StageName], ctx);
  }
  if (name && Object.hasOwn(CHECKS, name)) {
    warnBunVersion(ctx.root);
    return checks([name as CheckName], ctx);
  }
  return usage();
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
