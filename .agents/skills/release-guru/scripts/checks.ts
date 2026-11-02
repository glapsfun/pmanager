import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Ctx, Result } from "./context";
import {
  type Evidence,
  pidAlive,
  type ReleaseState,
  readState,
  type StatePaths,
  statePaths,
  writeState,
} from "./state";

export const GATE_CMD = ["bun", "ci/gate.ts", "pre-push"];
export const RELEASE_SCRIPT = join(import.meta.dir, "release.ts");
const TAIL_LINES = 60;
const CHECKABLE = ["prepared", "checked", "blocked"];

/** Release runs write their history and report into the state dir, so tracked files never change. */
export function agentsCmd(p: StatePaths): string[] {
  return [
    "bun",
    "run",
    "bench.ts",
    "agent-e2e",
    "--history",
    p.agentHistory,
    "--report",
    p.agentReport,
  ];
}

const tail = (s: string) => s.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
const short = (sha: string) => sha.slice(0, 7);

async function toolVersions(ctx: Ctx): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const bin of ["bun", "claude", "codex"]) {
    const r = await ctx.run([bin, "--version"], ctx.cfg.root).catch(() => null);
    out[bin] = r && r.code === 0 ? (r.stdout.trim().split("\n")[0] ?? "") : "missing";
  }
  return out;
}

export async function cmdCheck(ctx: Ctx, opts: { foreground?: boolean }): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 1, phase: "none", message: "no release in progress", next: "run prepare" };
  if (s.kind !== "release" || !CHECKABLE.includes(s.phase)) {
    return { code: 1, phase: s.phase, message: `nothing to check in phase ${s.phase}` };
  }
  if (s.checksPid !== undefined && pidAlive(s.checksPid)) {
    return { code: 3, phase: s.phase, message: "checks are already running", next: "run wait" };
  }
  if ((await ctx.git.head()) !== s.commit || (await ctx.git.dirty()).length > 0) {
    return {
      code: 1,
      phase: s.phase,
      message: `HEAD is not the prepared candidate ${short(s.commit)} with a clean tree`,
      next: `switch to ${s.branch} and remove other changes, or abandon and prepare again`,
    };
  }
  if (opts.foreground) return runChecks(ctx);
  const paths = statePaths(ctx.cfg);
  const pid = ctx.spawnDetached(
    [process.execPath, RELEASE_SCRIPT, "run-checks"],
    ctx.cfg.root,
    paths.log,
  );
  await writeState(ctx.cfg, { ...s, checksPid: pid }, ctx.now());
  return {
    code: 3,
    phase: s.phase,
    message: `checks started (pid ${pid}); log: ${paths.log}`,
    next: "run wait",
  };
}

function evidence(
  s: ReleaseState,
  check: Evidence["check"],
  command: string[],
  tools: Record<string, string>,
  startedAt: string,
  finishedAt: string,
  result: Evidence["result"],
  detail: string,
): Evidence {
  return {
    check,
    command,
    commit: s.commit,
    tree: s.tree,
    tools,
    result,
    detail,
    startedAt,
    finishedAt,
  };
}

/** The checks themselves; the detached runner and --foreground both end here. */
export async function runChecks(ctx: Ctx): Promise<Result> {
  const start = await readState(ctx.cfg);
  if (!start) return { code: 1, phase: "none", message: "no release in progress" };
  const paths = statePaths(ctx.cfg);
  await mkdir(dirname(paths.log), { recursive: true });
  const tools = await toolVersions(ctx);
  const ran: Evidence[] = [];
  const blockers: string[] = [];

  const gateStart = ctx.now().toISOString();
  const gate = await ctx.run(GATE_CMD, ctx.cfg.root);
  const gateOut = gate.stdout + gate.stderr;
  await appendFile(paths.log, gateOut);
  ran.push(
    evidence(
      start,
      "gate",
      GATE_CMD,
      tools,
      gateStart,
      ctx.now().toISOString(),
      gate.code === 0 ? "pass" : "fail",
      tail(gateOut),
    ),
  );
  if (gate.code !== 0) {
    blockers.push(`gate failed for tree ${short(start.tree)}: see ${paths.log}`);
  } else {
    const cmd = agentsCmd(paths);
    const agentsStart = ctx.now().toISOString();
    const agents = await ctx.run(cmd, join(ctx.cfg.root, "bench"));
    const out = agents.stdout + agents.stderr;
    await appendFile(paths.log, out);
    // agent-e2e exits 0 when only a report-only harness is missing, so "unavailable" plus a failure means a blocking one.
    const result: Evidence["result"] =
      agents.code === 0 ? "pass" : /^\S+ unavailable$/m.test(out) ? "unavailable" : "fail";
    ran.push(
      evidence(
        start,
        "agents",
        cmd,
        tools,
        agentsStart,
        ctx.now().toISOString(),
        result,
        tail(out),
      ),
    );
    if (result === "unavailable") blockers.push("agent e2e: a blocking harness was unavailable");
    if (result === "fail") blockers.push(`agent e2e failed: see ${paths.agentReport}`);
  }

  const moved =
    (await ctx.git.head()) !== start.commit ||
    (await ctx.git.tree("HEAD")) !== start.tree ||
    (await ctx.git.dirty()).length > 0;
  if (moved) {
    for (const e of ran) Object.assign(e, { result: "fail", detail: "tree changed during checks" });
    blockers.unshift("the tree changed during checks; check again on an unchanged candidate");
  }

  const s = (await readState(ctx.cfg)) ?? start;
  const passed = blockers.length === 0 && ran.length === 2;
  const next: ReleaseState = {
    ...s,
    evidence: [...s.evidence, ...ran],
    phase: passed ? "checked" : "blocked",
    blockers,
  };
  delete next.checksPid;
  await writeState(ctx.cfg, next, ctx.now());
  return {
    code: passed ? 0 : 1,
    phase: next.phase,
    message: passed ? `checks passed for tree ${short(s.tree)}` : "checks did not pass",
    next: passed ? "run summary" : "fix the blockers and run check again, or run abandon",
    ...(blockers.length > 0 ? { blockers } : {}),
    data: { evidence: ran.map(({ check, result, tree }) => ({ check, result, tree })) },
  };
}

/** Polls the state until the checks finish or timeout seconds pass. */
export async function cmdWait(ctx: Ctx, opts: { timeout?: number }): Promise<Result> {
  const deadline = Date.now() + (opts.timeout ?? 540) * 1000;
  for (;;) {
    const s = await readState(ctx.cfg);
    if (!s) return { code: 1, phase: "none", message: "no release in progress" };
    if (s.checksPid === undefined) {
      const done = s.phase === "checked";
      return {
        code: done ? 0 : 1,
        phase: s.phase,
        message: `checks finished: ${s.phase}`,
        next: done ? "run summary" : "fix the blockers and run check again, or run abandon",
        ...(s.blockers.length > 0 ? { blockers: s.blockers } : {}),
      };
    }
    if (!pidAlive(s.checksPid)) {
      return {
        code: 1,
        phase: s.phase,
        message: "the checks process stopped without a result",
        blockers: [`checks process ${s.checksPid} is gone without a result`],
        next: `see ${statePaths(ctx.cfg).log}, then run check again`,
      };
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      return {
        code: 3,
        phase: s.phase,
        message: "checks are still running",
        next: "run wait again",
      };
    }
    await Bun.sleep(Math.min(5000, left));
  }
}
