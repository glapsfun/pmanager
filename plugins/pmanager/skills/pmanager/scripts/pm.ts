#!/usr/bin/env bun
import { join } from "node:path";
import { check } from "./check";
import { claim, claimBranch, release, remoteEpicOf } from "./claim";
import { countBySeverity, formatFindings } from "./findings";
import {
  commitPaths,
  fetchOrigin,
  hasRemote,
  listRemoteBranches,
  pushSetUpstream,
  repoRoot,
} from "./git";
import { buildHandoff, loadLocalRepoMap } from "./handoff";
import { applyRender, migrate } from "./render";
import { loadPmRepo, PM_DIR, type PmRepo } from "./repo";
import { buildStatus, formatStatus, type RemoteClaims, type RemoteState } from "./status";

const USAGE = `usage: bun run scripts/pm.ts <command> [args] [flags]

commands
  check                         validate docs/pm (read-only)
  render [--migrate]            regenerate INDEX.md, plan task tables, memo log
  claim <slug> [--takeover]     claim an epic on branch pm/<slug> and push it
  release <slug>                release an epic (clears session, pushes)
  status                        epics, owners, stale claims, next task
  handoff <slug> <task-id>      print an execution brief

flags
  --json                        machine-readable output on stdout
  --stale-days N                claim staleness threshold (default 14)
  --harness NAME                harness name recorded in claims (default: $PM_HARNESS, or claude-code when $CLAUDECODE is set)

exit codes: 0 ok/warnings, 1 errors or claim refused, 2 usage/environment
`;

export interface Args {
  cmd: string;
  positional: string[];
  json: boolean;
  staleDays: number;
  takeover: boolean;
  harness: string;
  migrate: boolean;
}

export function defaultHarness(env = process.env): string {
  return env.PM_HARNESS ?? (env.CLAUDECODE ? "claude-code" : "unknown");
}

export function today(env = process.env): string {
  return env.PM_TODAY ?? new Date().toISOString().slice(0, 10);
}

export function parseArgs(argv: string[]): Args | null {
  const args: Args = {
    cmd: "",
    positional: [],
    json: false,
    staleDays: 14,
    takeover: false,
    harness: defaultHarness(),
    migrate: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--json") args.json = true;
    else if (a === "--takeover") args.takeover = true;
    else if (a === "--migrate") args.migrate = true;
    else if (a === "--stale-days") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n < 0) return null;
      args.staleDays = n;
    } else if (a === "--harness") {
      const h = argv[++i];
      if (!h) return null;
      args.harness = h;
    } else if (a.startsWith("--")) return null;
    else if (args.cmd === "") args.cmd = a;
    else args.positional.push(a);
  }
  return args.cmd === "" ? null : args;
}

function out(text: string): void {
  process.stdout.write(text);
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 2;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function renderAndCommit(root: string, slug: string, verb: string): Promise<string[]> {
  const written = await applyRender(await loadPmRepo(root));
  if (written.length > 0) {
    await commitPaths(root, written, `docs(pm): render after ${verb} ${slug}`);
    await pushSetUpstream(root, claimBranch(slug));
  }
  return written;
}

async function remoteClaims(
  root: string,
): Promise<{ remote: RemoteState; claims: RemoteClaims | null }> {
  if (!(await hasRemote(root))) return { remote: "none", claims: null };
  if (!(await fetchOrigin(root))) return { remote: "unreachable", claims: null };
  const claims: RemoteClaims = new Map();
  for (const b of await listRemoteBranches(root, "pm/")) {
    const slug = b.slice("pm/".length);
    claims.set(slug, await remoteEpicOf(root, slug));
  }
  return { remote: "ok", claims };
}

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const args = parseArgs(argv);
  if (!args) return fail(USAGE);
  const root = await repoRoot(cwd);
  if (!root) return fail("not inside a git repository");
  const opts = { staleDays: args.staleDays, today: today() };

  let repo: PmRepo;
  try {
    repo = await loadPmRepo(root);
  } catch {
    return fail(`no docs/pm directory under ${root} (expected ${join(root, PM_DIR)})`);
  }

  switch (args.cmd) {
    case "check": {
      const findings = check(repo, opts);
      const { errors, warnings } = countBySeverity(findings);
      out(
        args.json
          ? json({ ok: errors === 0, errors, warnings, findings })
          : formatFindings(findings),
      );
      return errors === 0 ? 0 : 1;
    }
    case "render": {
      const migrated = args.migrate ? await migrate(repo, opts.today) : [];
      const written = await applyRender(await loadPmRepo(root));
      if (args.json) out(json({ migrated, written }));
      else {
        for (const p of migrated) out(`migrated ${p}\n`);
        for (const p of written) out(`rendered ${p}\n`);
        if (migrated.length + written.length === 0) out("nothing to render\n");
      }
      return 0;
    }
    case "claim": {
      const slug = args.positional[0];
      if (!slug) return fail(USAGE);
      const result = await claim(root, slug, {
        harness: args.harness,
        takeover: args.takeover,
        staleDays: args.staleDays,
        today: opts.today,
      });
      const rendered = result.ok
        ? await renderAndCommit(root, slug, args.takeover ? "takeover of" : "claim")
        : [];
      out(args.json ? json({ ...result, rendered }) : `${result.message}\n`);
      if (result.ok) return 0;
      return result.reason === "no-epic" || result.reason === "no-remote" ? 2 : 1;
    }
    case "release": {
      const slug = args.positional[0];
      if (!slug) return fail(USAGE);
      const result = await release(root, slug, { harness: args.harness, today: opts.today });
      const rendered = result.ok ? await renderAndCommit(root, slug, "release") : [];
      out(args.json ? json({ ...result, rendered }) : `${result.message}\n`);
      return result.ok ? 0 : 1;
    }
    case "status": {
      const { remote, claims } = await remoteClaims(root);
      const report = buildStatus(repo, claims, remote, opts);
      out(args.json ? json(report) : formatStatus(report));
      return 0;
    }
    case "handoff": {
      const [slug, taskId] = args.positional;
      if (!slug || !taskId) return fail(USAGE);
      try {
        const brief = buildHandoff(repo, slug, taskId, await loadLocalRepoMap(repo.pmDir));
        out(args.json ? json({ brief }) : brief);
        return 0;
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
    default:
      return fail(USAGE);
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
