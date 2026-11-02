import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { draftNotes, previousRelease, proposeVersion, shippedChanges } from "./changes";
import type { Ctx, Result } from "./context";
import { preflight } from "./preflight";
import { compareVersions, formatVersion, parseVersion } from "./semver";
import { clearState, statePaths, writeState } from "./state";

const TOP_LEVEL_VERSION = /^( {2}"version"\s*:\s*")[^"]*(")/m;

/** Rewrites only the top-level "version" value, so the rest of the file keeps its bytes. */
export function bumpManifest(text: string, version: string): string {
  if (!TOP_LEVEL_VERSION.test(text)) throw new Error("no top-level version field");
  const out = text.replace(TOP_LEVEL_VERSION, `$1${version}$2`);
  if ((JSON.parse(out) as { version?: string }).version !== version) {
    throw new Error("the version field is not where it was expected");
  }
  return out;
}

const blocked = (message: string, blockers?: string[]): Result => ({
  code: 1,
  phase: "none",
  message,
  ...(blockers ? { blockers, next: "fix the blockers and run prepare again" } : {}),
});

export async function cmdPrepare(ctx: Ctx, opts: { version?: string }): Promise<Result> {
  const blockers = await preflight("prepare", ctx);
  if (blockers.length > 0) return blocked("prepare is blocked", blockers);
  const prev = await previousRelease(ctx.git, ctx.cfg);
  if (!prev) return blocked("no release tag yet: run baseline first");
  const changes = await shippedChanges(ctx.git, ctx.cfg, prev.tag);
  if (changes.length === 0) return blocked(`nothing to release since ${prev.tag}`);

  let next = proposeVersion(prev.version, changes);
  if (opts.version !== undefined) {
    const wanted = parseVersion(opts.version);
    if (!wanted) {
      return {
        code: 2,
        phase: "none",
        message: "--version must be X.Y.Z, with no prerelease part",
      };
    }
    if (compareVersions(wanted, prev.version) <= 0) {
      return {
        code: 2,
        phase: "none",
        message: `--version ${opts.version} is not newer than ${prev.tag}`,
      };
    }
    next = wanted;
  }
  const version = formatVersion(next);
  const tag = `v${version}`;
  if (await ctx.git.remoteTag(tag)) return blocked(`${tag} already exists on origin`);

  const branch = `release/${tag}`;
  await ctx.git.out(["switch", "-q", "-c", branch, `origin/${ctx.cfg.base}`]);
  for (const m of ctx.cfg.manifests) {
    const file = join(ctx.cfg.root, m);
    await writeFile(file, bumpManifest(await readFile(file, "utf8"), version));
  }
  await ctx.git.out(["add", "--", ...ctx.cfg.manifests]);
  await ctx.git.out(["commit", "-q", "-m", `chore(release): ${tag}`]);

  const paths = statePaths(ctx.cfg);
  await clearState(ctx.cfg);
  await mkdir(dirname(paths.notes), { recursive: true });
  await writeFile(paths.notes, draftNotes(changes));
  const commit = await ctx.git.head();
  const tree = await ctx.git.tree("HEAD");
  await writeState(
    ctx.cfg,
    {
      schema: 1,
      repo: ctx.cfg.slug,
      kind: "release",
      version,
      previousTag: prev.tag,
      branch,
      commit,
      tree,
      phase: "prepared",
      blockers: [],
      evidence: [],
      publish: {},
      verify: [],
      updatedAt: "",
    },
    ctx.now(),
  );
  return {
    code: 0,
    phase: "prepared",
    message: `prepared ${tag} on ${branch}; nothing was pushed`,
    next: `rewrite the notes in ${paths.notes} for users, keep every citation, then run check`,
    data: {
      version,
      previousTag: prev.tag,
      branch,
      commit,
      tree,
      changes: changes.length,
      notes: paths.notes,
    },
  };
}
