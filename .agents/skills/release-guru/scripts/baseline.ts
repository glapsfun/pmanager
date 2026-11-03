import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Ctx, Result } from "./context";
import { preflight } from "./preflight";
import { ensureRelease, pushTag } from "./publish";
import { parseVersion } from "./semver";
import { type ReleaseState, readState, statePaths, writeState } from "./state";
import { cmdVerify } from "./verify";

const PASSING = ["SUCCESS", "SKIPPED", "NEUTRAL"];

export function baselineNotes(version: string, subject: string, sha: string): string {
  const pr = /^Merge pull request #(\d+)/.exec(subject)?.[1];
  const origin = pr ? `as merged in #${pr}` : `as of ${sha.slice(0, 7)}`;
  return `Baseline release: pmanager ${version} ${origin}. Earlier versions were not tagged. Later releases list their changes against this tag.\n`;
}

const stop = (message: string, blockers?: string[]): Result => ({
  code: 1,
  phase: "none",
  message,
  ...(blockers ? { blockers } : {}),
});

/** One-time: tags an already merged commit as the first release, using the CI it already has. */
export async function cmdBaseline(ctx: Ctx, opts: { commit: string }): Promise<Result> {
  const existing = await readState(ctx.cfg);
  if (existing && existing.kind !== "baseline" && existing.phase !== "published") {
    return stop(
      `another release is in progress: v${existing.version} (${existing.phase}); abandon it first`,
    );
  }
  await ctx.git.ok(["fetch", "-q", "origin", "--tags"]);
  const sha = await ctx.git
    .out(["rev-parse", "--verify", `${opts.commit}^{commit}`])
    .catch(() => "");
  if (!sha) return stop(`unknown commit ${opts.commit}`);
  // Another commit would overwrite the state, and with it a verify that may still be owed.
  if (existing?.kind === "baseline" && existing.commit !== sha) {
    const first = existing.commit.slice(0, 7);
    return stop(
      `a baseline for v${existing.version} on ${first} already exists: rerun baseline --commit ${first} to finish or verify it`,
    );
  }
  const short = sha.slice(0, 7);
  const versions = await Promise.all(
    ctx.cfg.manifests.map(
      async (m) =>
        (JSON.parse(await ctx.git.out(["show", `${sha}:${m}`])) as { version?: string }).version ??
        "",
    ),
  );
  if (new Set(versions).size > 1)
    return stop(`manifest versions differ at ${short}: ${versions.join(" vs ")}`);
  const version = versions[0] as string;
  if (!parseVersion(version)) return stop(`manifest version ${version} at ${short} is not X.Y.Z`);

  const blockers = await preflight("baseline", ctx, version);
  if (blockers.length > 0) return stop("baseline is blocked", blockers);
  if (!(await ctx.git.ok(["merge-base", "--is-ancestor", sha, `origin/${ctx.cfg.base}`]))) {
    return stop(`${short} is not on origin/${ctx.cfg.base}`);
  }
  const checks = await ctx.gh.commitChecks(sha);
  if (checks.length === 0) return stop(`no CI results recorded for ${short}`);
  const failing = checks.filter(
    (c) => c.status !== "COMPLETED" || !PASSING.includes(c.conclusion ?? ""),
  );
  if (failing.length > 0) {
    return stop(
      "CI did not pass on the baseline commit",
      failing.map((c) => `CI check ${c.name} is ${c.conclusion ?? c.status} on ${short}`),
    );
  }

  const resuming = existing?.kind === "baseline" && existing.commit === sha;
  const s: ReleaseState = resuming
    ? existing
    : {
        schema: 1,
        repo: ctx.cfg.slug,
        kind: "baseline",
        version,
        previousTag: null,
        branch: null,
        commit: sha,
        tree: await ctx.git.tree(sha),
        phase: "publishing",
        blockers: [],
        evidence: [],
        publish: { mergeCommit: sha },
        verify: [],
        updatedAt: "",
      };
  if (s.phase === "published" || s.phase === "published-verify-failed") return cmdVerify(ctx);
  if (!resuming) {
    const notes = statePaths(ctx.cfg).notes;
    await mkdir(dirname(notes), { recursive: true });
    await writeFile(
      notes,
      baselineNotes(version, await ctx.git.out(["log", "-1", "--format=%s", sha]), sha),
    );
    await writeState(ctx.cfg, s, ctx.now());
  }
  const stopped = (await pushTag(ctx, s, sha)) ?? (await ensureRelease(ctx, s));
  if (stopped) return stopped;
  s.phase = "published";
  await writeState(ctx.cfg, s, ctx.now());
  return cmdVerify(ctx);
}
