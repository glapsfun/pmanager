import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { Config } from "./config";

export type Phase =
  | "prepared"
  | "checked"
  | "blocked"
  | "approved"
  | "publishing"
  | "published"
  | "published-verify-failed";

export interface Evidence {
  check: "gate" | "agents";
  command: string[];
  commit: string;
  tree: string;
  tools: Record<string, string>;
  result: "pass" | "fail" | "unavailable";
  detail: string;
  startedAt: string;
  finishedAt: string;
}

export interface RouteResult {
  route: "github" | "claude-code" | "codex" | "gskill";
  ok: boolean;
  detail: string;
}

export interface ReleaseState {
  schema: 1;
  repo: string;
  kind: "release" | "baseline";
  version: string;
  previousTag: string | null;
  branch: string | null;
  commit: string;
  tree: string;
  phase: Phase;
  blockers: string[];
  evidence: Evidence[];
  checksPid?: number;
  approvedTree?: string;
  publish: {
    pushed?: boolean;
    pr?: number;
    mergeCommit?: string;
    tagged?: boolean;
    released?: boolean;
  };
  verify: RouteResult[];
  updatedAt: string;
}

export interface StatePaths {
  dir: string;
  state: string;
  notes: string;
  summary: string;
  log: string;
  agentHistory: string;
  agentReport: string;
  lock: string;
}

export function statePaths(cfg: Config): StatePaths {
  const dir = join(cfg.root, cfg.stateDir);
  return {
    dir,
    state: join(dir, "state.json"),
    notes: join(dir, "notes.md"),
    summary: join(dir, "summary.md"),
    log: join(dir, "checks.log"),
    agentHistory: join(dir, "agent-e2e", "history.jsonl"),
    agentReport: join(dir, "agent-e2e", "report.md"),
    lock: join(dir, "lock"),
  };
}

export async function readState(cfg: Config): Promise<ReleaseState | null> {
  const file = statePaths(cfg).state;
  if (!existsSync(file)) return null;
  const s = JSON.parse(await readFile(file, "utf8")) as ReleaseState;
  if (s.schema !== 1) throw new Error(`${file}: unknown schema ${s.schema}`);
  if (s.repo !== cfg.slug) throw new Error(`${file} belongs to ${s.repo}, not ${cfg.slug}`);
  return s;
}

/** Writes through a temp file so a crash never leaves half a state behind. */
export async function writeState(
  cfg: Config,
  s: ReleaseState,
  now: Date = new Date(),
): Promise<void> {
  const p = statePaths(cfg);
  await mkdir(p.dir, { recursive: true });
  s.updatedAt = now.toISOString();
  await writeFile(`${p.state}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  await rename(`${p.state}.tmp`, p.state);
}

export async function clearState(cfg: Config): Promise<void> {
  await rm(statePaths(cfg).dir, { recursive: true, force: true });
}

export function freshEvidence(s: ReleaseState): { gate?: Evidence; agents?: Evidence } {
  const out: { gate?: Evidence; agents?: Evidence } = {};
  for (const e of s.evidence) {
    if (e.tree !== s.tree) continue;
    const seen = out[e.check];
    if (!seen || e.finishedAt > seen.finishedAt) out[e.check] = e;
  }
  return out;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface LockInfo {
  pid: number;
  command: string;
  host: string;
  startedAt: string;
}

export async function acquireLock(
  cfg: Config,
  command: string,
  pid: number = process.pid,
): Promise<{ ok: true } | { ok: false; holder: string }> {
  const p = statePaths(cfg);
  await mkdir(p.dir, { recursive: true });
  const info: LockInfo = { pid, command, host: hostname(), startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(p.lock, JSON.stringify(info), { flag: "wx" });
      return { ok: true };
    } catch {
      const held = JSON.parse(await readFile(p.lock, "utf8")) as LockInfo;
      // Only this host can tell whether the pid is gone.
      if (held.host === hostname() && !pidAlive(held.pid)) {
        await rm(p.lock, { force: true });
        continue;
      }
      return {
        ok: false,
        holder: `${held.command} (pid ${held.pid} on ${held.host}, since ${held.startedAt})`,
      };
    }
  }
  return { ok: false, holder: "a lock that could not be replaced" };
}

export async function releaseLock(cfg: Config): Promise<void> {
  await rm(statePaths(cfg).lock, { force: true });
}
