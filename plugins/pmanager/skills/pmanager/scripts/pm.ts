#!/usr/bin/env bun
import { join } from "node:path";
import { check } from "./check";
import { claim, claimBranch, release, remoteEpicOf } from "./claim";
import { countBySeverity, formatFindings } from "./findings";
import {
  commitPaths,
  fetchOrigin,
  hasRemote,
  listFetchedBranches,
  pushSetUpstream,
  repoRoot,
} from "./git";
import { buildHandoff, loadLocalRepoMap, readLocalRepoMap } from "./handoff";
import { applyRender, migrate } from "./render";
import { epicBySlug, loadPmRepo, PM_DIR, type PmRepo, taskById } from "./repo";
import { buildResearch, formatResearch, normalizeKeywords } from "./research";
import { buildStatus, formatStatus, type RemoteClaims, type RemoteState } from "./status";
import { buildVerify, formatVerify, resolveRepos, resolveTarget } from "./verify";

const USAGE = `usage: bun run scripts/pm.ts <command> [args] [flags]

commands
  check                         validate docs/pm (read-only)
  render [--migrate]            regenerate INDEX.md, plan task tables, memo log
  claim <slug> [--takeover]     claim an epic on branch pm/<slug> and push it
  release <slug> [--force]      release an epic you own (clears session, pushes); --force overrides another harness's claim
  status                        epics, owners, stale claims, next task
  handoff <slug> <task-id>      print an execution brief
  research <keyword>... [--path P]... [--repo NAME|PATH] [--limit N] [--no-gh]
                                one concurrent read-only sweep: files, history, docs, memory, tests, gh
  verify <slug> <task-id> [--repo NAME|PATH] [--since REF] [--files P]... [--limit N]
                                read-only evidence per acceptance criterion from the task's files, commits and diff

flags
  --json                        machine-readable output on stdout
  --stale-days N                claim staleness threshold (default 14)
  --harness NAME                harness name recorded in claims (default: $PM_HARNESS, or claude-code when $CLAUDECODE is set)
  --path P                      git pathspec to scope research (repeatable)
  --repo NAME|PATH              target checkout: a docs/pm/.local/repos.json name or a path (default: this repo)
  --limit N                     max entries per research/verify section (default 20)
  --no-gh                       skip the gh PR/issue probe
  --since REF                   verify: lower bound of the inspected window (default: task updated, else epic created)
  --files P                     verify: extra path to inspect, relative to each repo root (repeatable)

exit codes: 0 ok/warnings, 1 errors or claim refused, 2 usage/environment
`;

export interface Args {
  cmd: string;
  positional: string[];
  json: boolean;
  staleDays: number;
  takeover: boolean;
  force: boolean;
  harness: string;
  migrate: boolean;
  paths: string[];
  repo?: string;
  limit: number;
  noGh: boolean;
  since?: string;
  files: string[];
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
    force: false,
    harness: defaultHarness(),
    migrate: false,
    paths: [],
    limit: 20,
    noGh: false,
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--json") args.json = true;
    else if (a === "--takeover") args.takeover = true;
    else if (a === "--force") args.force = true;
    else if (a === "--migrate") args.migrate = true;
    else if (a === "--stale-days") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n < 0) return null;
      args.staleDays = n;
    } else if (a === "--harness") {
      const h = argv[++i];
      if (!h) return null;
      args.harness = h;
    } else if (a === "--no-gh") args.noGh = true;
    else if (a === "--path") {
      const p = argv[++i];
      if (!p) return null;
      args.paths.push(p);
    } else if (a === "--repo") {
      const r = argv[++i];
      if (!r) return null;
      args.repo = r;
    } else if (a === "--limit") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n < 1) return null;
      args.limit = n;
    } else if (a === "--since") {
      const s = argv[++i];
      if (!s) return null;
      args.since = s;
    } else if (a === "--files") {
      const f = argv[++i];
      if (!f) return null;
      args.files.push(f);
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

interface RenderPush {
  written: string[];
  pushed: boolean;
  error?: string;
}

async function renderAndCommit(root: string, slug: string, verb: string): Promise<RenderPush> {
  const written = await applyRender(await loadPmRepo(root));
  if (written.length === 0) return { written, pushed: true };
  await commitPaths(root, written, `docs(pm): render after ${verb} ${slug}`);
  const push = await pushSetUpstream(root, claimBranch(slug));
  if (push.code === 0) return { written, pushed: true };
  return { written, pushed: false, error: push.stderr.trim() };
}

function renderPushFailure(slug: string, r: RenderPush): string {
  return `rendered views committed locally on ${claimBranch(slug)} but push failed: ${r.error ?? "unknown"}\nretry with: git push origin ${claimBranch(slug)}\n`;
}

async function remoteClaims(
  root: string,
): Promise<{ remote: RemoteState; claims: RemoteClaims | null }> {
  if (!(await hasRemote(root))) return { remote: "none", claims: null };
  if (!(await fetchOrigin(root))) return { remote: "unreachable", claims: null };
  // The pruned fetch above made the remote-tracking refs exact, so list them locally
  // instead of paying a second round trip to origin.
  const slugs = (await listFetchedBranches(root, "pm/")).map((b) => b.slice("pm/".length));
  const epics = await Promise.all(slugs.map((slug) => remoteEpicOf(root, slug)));
  const claims: RemoteClaims = new Map(slugs.map((slug, i) => [slug, epics[i] ?? null]));
  return { remote: "ok", claims };
}

async function runResearch(root: string, args: Args): Promise<number> {
  const keywords = normalizeKeywords(args.positional);
  if (keywords.length === 0) return fail(USAGE);
  const map = await readLocalRepoMap(join(root, PM_DIR));
  const resolved = await resolveTarget(root, args.repo, map);
  if ("error" in resolved) return fail(resolved.error);
  const report = await buildResearch({
    root,
    cwd: resolved.target.path,
    keywords,
    paths: args.paths,
    limit: args.limit,
    gh: !args.noGh,
    ghCmd: process.env.PM_GH,
  });
  out(args.json ? json(report) : formatResearch(report));
  return 0;
}

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const args = parseArgs(argv);
  if (!args) return fail(USAGE);
  const root = await repoRoot(cwd);
  if (!root) return fail("not inside a git repository");
  if (args.cmd === "research") return runResearch(root, args);
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
      const render = result.ok
        ? await renderAndCommit(root, slug, args.takeover ? "takeover of" : "claim")
        : { written: [], pushed: true };
      const failure = result.ok && !render.pushed ? renderPushFailure(slug, render) : "";
      out(
        args.json
          ? json({
              ...result,
              rendered: render.written,
              renderPush: { ok: render.pushed, error: render.error },
            })
          : `${result.message}\n${failure}`,
      );
      if (result.ok) return render.pushed ? 0 : 1;
      return result.reason === "no-epic" || result.reason === "no-remote" ? 2 : 1;
    }
    case "release": {
      const slug = args.positional[0];
      if (!slug) return fail(USAGE);
      const result = await release(root, slug, {
        harness: args.harness,
        today: opts.today,
        force: args.force,
      });
      const render = result.ok
        ? await renderAndCommit(root, slug, "release")
        : { written: [], pushed: true };
      const failure = result.ok && !render.pushed ? renderPushFailure(slug, render) : "";
      out(
        args.json
          ? json({
              ...result,
              rendered: render.written,
              renderPush: { ok: render.pushed, error: render.error },
            })
          : `${result.message}\n${failure}`,
      );
      if (result.ok) return render.pushed ? 0 : 1;
      return result.reason === "no-remote" || result.reason === "no-branch" ? 2 : 1;
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
    case "verify": {
      const [slug, taskId] = args.positional;
      if (!slug || !taskId) return fail(USAGE);
      const epic = epicBySlug(repo, slug);
      if (!epic?.epic) return fail(`unknown epic ${slug}`);
      const task = taskById(epic, taskId);
      if (!task) return fail(`unknown task ${taskId} in ${slug}`);
      const map = await readLocalRepoMap(repo.pmDir);
      const resolved = await resolveRepos(root, epic, args.repo, map);
      if ("error" in resolved) return fail(resolved.error);
      const report = await buildVerify({
        epic,
        task,
        targets: resolved.targets,
        gaps: resolved.gaps,
        sinceRef: args.since,
        files: args.files,
        limit: args.limit,
      });
      if (report.repos.every((r) => !r.bounded)) return fail(report.errors.join("\n"));
      out(args.json ? json(report) : formatVerify(report));
      return 0;
    }
    default:
      return fail(USAGE);
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
