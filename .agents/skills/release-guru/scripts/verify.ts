import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedEnv } from "../../../../ci/e2e/isolated-env";
import type { Ctx, Result, Route } from "./context";
import type { Git } from "./git";
import { type ReleaseState, type RouteResult, readState, statePaths, writeState } from "./state";

const PLUGIN = "pmanager@pmanager";

/** Files under prefix in the tag's tree that are missing from dir or differ there, in tree order. */
export async function compareToTag(
  git: Git,
  tag: string,
  prefix: string,
  dir: string,
): Promise<string[]> {
  const entries = (await git.out(["ls-tree", "-r", tag, "--", prefix]))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta = "", path = ""] = line.split("\t");
      const [mode, , sha] = meta.split(" ");
      return { mode, sha, rel: path.slice(prefix.length + 1) };
    })
    .filter((e) => e.mode !== "120000");
  const present = entries.filter((e) => existsSync(join(dir, e.rel)));
  const hashes = present.length
    ? (await git.out(["hash-object", "--", ...present.map((e) => join(dir, e.rel))])).split("\n")
    : [];
  const actual = new Map(present.map((e, i) => [e.rel, hashes[i]]));
  const out: string[] = [];
  for (const e of entries) {
    if (!actual.has(e.rel)) out.push(`missing ${e.rel}`);
    else if (actual.get(e.rel) !== e.sha) out.push(`differs ${e.rel}`);
  }
  return out;
}

const tagOf = (s: ReleaseState) => `v${s.version}`;
const releaseCommit = (s: ReleaseState) =>
  s.kind === "baseline" ? s.commit : s.publish.mergeCommit;

/** Runs one CLI step in the isolated env; a thrown spawn means the binary is not installed. */
async function step(ctx: Ctx, cmd: string[], cwd: string, env: Record<string, string>) {
  try {
    return await ctx.run(cmd, cwd, env, false);
  } catch {
    throw new Unavailable(cmd[0] as string);
  }
}

class Unavailable extends Error {
  constructor(readonly bin: string) {
    super(`${bin} not found`);
  }
}

async function guarded(
  route: RouteResult["route"],
  body: () => Promise<string | null>,
): Promise<RouteResult> {
  try {
    const problem = await body();
    return problem === null
      ? { route, ok: true, detail: "installed the tagged files" }
      : { route, ok: false, detail: problem };
  } catch (e) {
    if (e instanceof Unavailable)
      return { route, ok: false, detail: `unavailable: ${e.bin} not found` };
    return { route, ok: false, detail: (e as Error).message };
  }
}

async function isolated(tmp: string): Promise<Record<string, string>> {
  const env = isolatedEnv(tmp);
  for (const dir of [env.HOME, env.CLAUDE_CONFIG_DIR, env.CODEX_HOME])
    await mkdir(dir as string, { recursive: true });
  return env;
}

const failed = (r: { code: number; stdout: string; stderr: string }, what: string) =>
  r.code !== 0
    ? `${what} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`
    : null;

export const githubRoute: Route = async (ctx, s) => {
  const tag = tagOf(s);
  const problems: string[] = [];
  const remote = await ctx.git.remoteTag(tag);
  if (remote !== releaseCommit(s))
    problems.push(`${tag} is on ${remote ?? "nothing"}, expected ${releaseCommit(s)}`);
  const rel = await ctx.gh.release(tag);
  const notesFile = statePaths(ctx.cfg).notes;
  const notes = existsSync(notesFile) ? await readFile(notesFile, "utf8") : "";
  if (!rel) problems.push(`no GitHub release for ${tag}`);
  else {
    if (rel.draft) problems.push("the release is a draft");
    if (rel.prerelease) problems.push("the release is a prerelease");
    if (!rel.latest) problems.push("the release is not marked latest");
    if (rel.body.trim() !== notes.trim()) problems.push("release body differs from the notes");
  }
  return problems.length === 0
    ? { route: "github", ok: true, detail: "tag and release match" }
    : { route: "github", ok: false, detail: problems.join("; ") };
};

export const claudeRoute: Route = (ctx, s, tmp) =>
  guarded("claude-code", async () => {
    const env = await isolated(tmp);
    const add = await step(
      ctx,
      ["claude", "plugin", "marketplace", "add", `${ctx.cfg.slug}@${tagOf(s)}`, "--json"],
      tmp,
      env,
    );
    const install =
      add.code === 0 ? await step(ctx, ["claude", "plugin", "install", PLUGIN], tmp, env) : add;
    const bad = failed(add, "marketplace add") ?? failed(install, "plugin install");
    if (bad) return bad;
    const list = await step(ctx, ["claude", "plugin", "list", "--json"], tmp, env);
    if (list.code !== 0) return failed(list, "plugin list");
    const entry = (
      JSON.parse(list.stdout) as {
        id: string;
        enabled: boolean;
        version: string;
        installPath: string;
      }[]
    ).find((p) => p.id === PLUGIN);
    if (!entry?.enabled) return `${PLUGIN} is not installed and enabled`;
    if (entry.version !== s.version)
      return `installed version ${entry.version}, expected ${s.version}`;
    const diff = await compareToTag(ctx.git, tagOf(s), ctx.cfg.pluginDir, entry.installPath);
    return diff.length === 0 ? null : diff.join("; ");
  });

export const codexRoute: Route = (ctx, s, tmp) =>
  guarded("codex", async () => {
    const env = await isolated(tmp);
    const add = await step(
      ctx,
      [
        "codex",
        "plugin",
        "marketplace",
        "add",
        `https://github.com/${ctx.cfg.slug}`,
        "--ref",
        tagOf(s),
      ],
      tmp,
      env,
    );
    const install =
      add.code === 0 ? await step(ctx, ["codex", "plugin", "add", PLUGIN], tmp, env) : add;
    const bad = failed(add, "marketplace add") ?? failed(install, "plugin add");
    if (bad) return bad;
    const list = await step(ctx, ["codex", "plugin", "list", "-m", "pmanager"], tmp, env);
    const version = s.version.replace(/\./g, "\\.");
    if (!new RegExp(`${PLUGIN}\\s+installed, enabled\\s+${version}\\b`).test(list.stdout)) {
      return `codex does not list ${PLUGIN} ${s.version} as installed and enabled`;
    }
    const cache = join(
      env.CODEX_HOME as string,
      "plugins",
      "cache",
      "pmanager",
      "pmanager",
      s.version,
    );
    const diff = await compareToTag(ctx.git, tagOf(s), ctx.cfg.pluginDir, cache);
    return diff.length === 0 ? null : diff.join("; ");
  });

interface LockEntry {
  skillPath?: string;
  gskill?: { commit?: string; version?: string };
}

/** Lock entries are found by shape, since only their fields are documented, not the nesting. */
function lockEntries(value: unknown, key = ""): [string, LockEntry][] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  if (obj.gskill && typeof obj.gskill === "object") return [[key, obj as LockEntry]];
  return Object.entries(obj).flatMap(([k, v]) => lockEntries(v, k));
}

export const gskillRoute: Route = (ctx, s, tmp) =>
  guarded("gskill", async () => {
    const env = await isolated(tmp);
    const project = join(tmp, "project");
    await mkdir(project, { recursive: true });
    await step(ctx, ["git", "init", "-q"], project, env);
    const add = await step(
      ctx,
      [
        "gskill",
        "add",
        `github.com/${ctx.cfg.slug}`,
        "--skill",
        "pmanager",
        "--version",
        s.version,
        "--agent",
        "claude",
      ],
      project,
      env,
    );
    const bad = failed(add, "gskill add");
    if (bad) return bad;
    const lockFile = join(project, "skills-lock.json");
    if (!existsSync(lockFile)) return "gskill wrote no skills-lock.json";
    const entry = lockEntries(JSON.parse(await readFile(lockFile, "utf8"))).find(
      ([k, e]) => k === "pmanager" || (e.skillPath ?? "").endsWith("skills/pmanager"),
    )?.[1];
    if (!entry) return "skills-lock.json has no pmanager entry";
    if (entry.gskill?.version !== s.version)
      return `locked version ${entry.gskill?.version}, expected ${s.version}`;
    const commit = await ctx.git.remoteTag(tagOf(s));
    if (entry.gskill?.commit !== commit)
      return `locked commit ${entry.gskill?.commit}, expected ${commit}`;
    return null;
  });

export const DEFAULT_ROUTES: Route[] = [githubRoute, claudeRoute, codexRoute, gskillRoute];

export async function cmdVerify(ctx: Ctx): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 1, phase: "none", message: "no release in progress" };
  const tag = tagOf(s);
  if (s.phase !== "published" && s.phase !== "published-verify-failed") {
    return { code: 1, phase: s.phase, message: `${tag} is not published yet; nothing to verify` };
  }
  await ctx.git.out(["fetch", "-q", "origin", "--tags"]);
  const results: RouteResult[] = [];
  for (const route of ctx.routes ?? DEFAULT_ROUTES) {
    const tmp = await mkdtemp(join(tmpdir(), "release-verify-"));
    try {
      results.push(await route(ctx, s, tmp));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  const bad = results.filter((r) => !r.ok);
  s.verify = results;
  s.phase = bad.length === 0 ? "published" : "published-verify-failed";
  await writeState(ctx.cfg, s, ctx.now());
  if (bad.length === 0) {
    return {
      code: 0,
      phase: s.phase,
      message: `${tag} is published and verified`,
      data: { verify: results },
    };
  }
  return {
    code: 1,
    phase: s.phase,
    message: `${tag} is published but verification failed: ${bad.map((r) => r.route).join(", ")}`,
    next: "investigate; rerun verify after a fix; a corrected release is a new patch version",
    blockers: bad.map((r) => `${r.route}: ${r.detail}`),
    data: { verify: results },
  };
}
