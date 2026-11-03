import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { capture } from "../../../../ci/proc";
import { clearGitEnv } from "../../../../plugins/pmanager/skills/pmanager/tests/git-env";
import { cmdAbandon } from "./abandon";
import { cmdBaseline } from "./baseline";
import { cmdCheck, cmdWait, runChecks } from "./checks";
import { type Config, defaultConfig } from "./config";
import type { Ctx, Result } from "./context";
import { gitClient } from "./git";
import { ghGitHub } from "./github";
import { cmdPrepare } from "./prepare";
import { cmdPublish } from "./publish";
import { acquireLock, pidAlive, readState, releaseLock } from "./state";
import { cmdStatus } from "./status";
import { cmdSummary } from "./summary";
import { cmdVerify } from "./verify";

export const USAGE = `usage: bun run release <command> [flags]
  status                          compare the saved release with git and GitHub
  prepare [--version X.Y.Z]       create release/vX.Y.Z, bump both manifests, draft notes
  check [--foreground]            run the gate and the paid agent e2e on the candidate
  wait [--timeout S]              wait up to S seconds (default 540) for running checks
  summary                         write and print the release summary
  publish --tree <hash> [--wait S]  publish the approved candidate; rerun to resume
  verify                          verify the published release and every install route
  abandon                         drop a candidate that was never published
  baseline --commit <sha>         one-time: tag and release the first version`;

export interface Flags {
  version?: string;
  tree?: string;
  commit?: string;
  timeout?: number;
  wait?: number;
  foreground?: boolean;
}

const VALUE_FLAGS = new Set(["--version", "--tree", "--commit", "--timeout", "--wait"]);

export function parseArgs(argv: string[]): { command: string; flags: Flags } | null {
  const [command, ...rest] = argv;
  if (!command || command.startsWith("-")) return null;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg === "--foreground") {
      flags.foreground = true;
      continue;
    }
    const value = rest[i + 1];
    if (!VALUE_FLAGS.has(arg) || value === undefined || value.startsWith("--")) return null;
    i++;
    if (arg === "--timeout" || arg === "--wait") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return null;
      flags[arg === "--timeout" ? "timeout" : "wait"] = n;
    } else {
      flags[arg.slice(2) as "version" | "tree" | "commit"] = value;
    }
  }
  return { command, flags };
}

/** Starts cmd in its own session so it outlives the agent's shell, logging to logFile. */
function spawnDetached(cmd: string[], cwd: string, logFile: string): number {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "a");
  try {
    const child = spawn(cmd[0] as string, cmd.slice(1), {
      cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    return child.pid ?? -1;
  } finally {
    closeSync(fd);
  }
}

export function realCtx(cfg: Config = defaultConfig()): Ctx {
  return {
    cfg,
    git: gitClient(cfg.root),
    gh: ghGitHub(cfg.slug),
    run: capture,
    now: () => new Date(),
    spawnDetached,
  };
}

type Command = (ctx: Ctx, flags: Flags) => Promise<Result>;

/** Commands that change state run one at a time across sessions. */
const COMMANDS: Record<string, { run: Command; locks: boolean }> = {
  status: { run: (ctx) => cmdStatus(ctx), locks: false },
  prepare: { run: (ctx, f) => cmdPrepare(ctx, { version: f.version }), locks: true },
  abandon: { run: (ctx) => cmdAbandon(ctx), locks: true },
  check: { run: (ctx, f) => cmdCheck(ctx, { foreground: f.foreground }), locks: true },
  // The detached runner; check already holds the lock and records its pid.
  "run-checks": { run: (ctx) => runChecks(ctx), locks: false },
  wait: { run: (ctx, f) => cmdWait(ctx, { timeout: f.timeout }), locks: false },
  summary: { run: (ctx) => cmdSummary(ctx), locks: false },
  verify: { run: (ctx) => cmdVerify(ctx), locks: true },
  baseline: {
    run: (ctx, f) => (f.commit ? cmdBaseline(ctx, { commit: f.commit }) : Promise.resolve(usage())),
    locks: true,
  },
  publish: {
    run: (ctx, f) =>
      f.tree ? cmdPublish(ctx, { tree: f.tree, wait: f.wait }) : Promise.resolve(usage()),
    locks: true,
  },
};

const usage = (message = USAGE): Result => ({ code: 2, phase: "none", message });

async function dispatch(ctx: Ctx, argv: string[]): Promise<Result> {
  const parsed = parseArgs(argv);
  const entry = parsed ? COMMANDS[parsed.command] : undefined;
  if (!parsed || !entry) return usage();
  if (!entry.locks) return entry.run(ctx, parsed.flags);
  const lock = await acquireLock(ctx.cfg, parsed.command);
  if (!lock.ok) {
    const s = await readState(ctx.cfg).catch(() => null);
    return {
      code: 1,
      phase: s?.phase ?? "none",
      message: `${parsed.command} is blocked`,
      blockers: [`another release-guru command is running: ${lock.holder}`],
    };
  }
  try {
    const s = await readState(ctx.cfg);
    if (parsed.command !== "check" && s?.checksPid !== undefined && pidAlive(s.checksPid)) {
      return {
        code: 1,
        phase: s.phase,
        message: `${parsed.command} is blocked`,
        blockers: [`checks are running (pid ${s.checksPid}): run wait`],
      };
    }
    return await entry.run(ctx, parsed.flags);
  } finally {
    await releaseLock(ctx.cfg);
  }
}

export async function main(
  argv: string[],
  deps: Partial<Ctx> & { out?: (s: string) => void } = {},
): Promise<number> {
  // A hook's GIT_DIR would point every git call at the hook's repository.
  clearGitEnv();
  const { out = (s: string) => process.stdout.write(s), ...overrides } = deps;
  const ctx: Ctx = { ...realCtx(overrides.cfg), ...overrides };
  let result: Result;
  try {
    result = await dispatch(ctx, argv);
  } catch (e) {
    result = { code: 1, phase: "none", message: `error: ${(e as Error).message}` };
  }
  out(`${JSON.stringify(result, null, 2)}\n`);
  return result.code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
