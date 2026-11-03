import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Ctx, Result } from "./context";
import { preflight } from "./preflight";
import { type ReleaseState, readState, statePaths, writeState } from "./state";
import { prBody, summaryBlockers } from "./summary";
import { cmdVerify } from "./verify";

const PASSING = ["SUCCESS", "SKIPPED", "NEUTRAL"];
const MERGEABLE = ["CLEAN", "HAS_HOOKS"];
const POLL_MS = 15_000;

const stop = (s: ReleaseState, message: string, extra: Partial<Result> = {}): Result => ({
  code: 1,
  phase: s.phase,
  message,
  ...extra,
});

async function save(ctx: Ctx, s: ReleaseState): Promise<void> {
  await writeState(ctx.cfg, s, ctx.now());
}

async function notesOf(ctx: Ctx): Promise<string> {
  const file = statePaths(ctx.cfg).notes;
  return existsSync(file) ? readFile(file, "utf8") : "";
}

/** Creates and pushes the annotated tag on commit; null when the tag is on origin at commit. */
export async function pushTag(ctx: Ctx, s: ReleaseState, commit: string): Promise<Result | null> {
  const tag = `v${s.version}`;
  const remote = await ctx.git.remoteTag(tag);
  if (remote && remote !== commit)
    return stop(s, `${tag} already exists on ${remote}`, {
      next: `run abandon; the next prepare needs --version above ${s.version}`,
    });
  if (!remote) {
    const local = await ctx.git
      .out(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`])
      .catch(() => "");
    if (local && local !== commit) {
      return stop(
        s,
        `a local tag ${tag} points at ${local}; delete it locally (git tag -d ${tag}) first`,
      );
    }
    if (!local) await ctx.git.out(["tag", "-a", tag, "-m", `pmanager ${tag}`, commit]);
    await ctx.git.out(["push", "-q", "origin", `refs/tags/${tag}`]);
  }
  s.publish.tagged = true;
  await save(ctx, s);
  return null;
}

/** Creates the GitHub release from the notes; null when a matching one exists. */
export async function ensureRelease(ctx: Ctx, s: ReleaseState): Promise<Result | null> {
  const tag = `v${s.version}`;
  const existing = await ctx.gh.release(tag);
  if (existing) {
    const same =
      !existing.draft &&
      !existing.prerelease &&
      existing.body.trim() === (await notesOf(ctx)).trim();
    if (!same) return stop(s, `a different release exists for ${tag}: ${existing.url}`);
  } else {
    await ctx.gh.createRelease(tag, tag, statePaths(ctx.cfg).notes);
  }
  s.publish.released = true;
  await save(ctx, s);
  return null;
}

/** Up to the merge: push, PR, wait for CI, merge. Returns the merge commit or a Result to stop with. */
async function mergeRelease(
  ctx: Ctx,
  s: ReleaseState,
  waitSeconds: number,
): Promise<string | Result> {
  const branch = s.branch as string;
  const tag = `v${s.version}`;
  const pr = await ctx.gh.findPr(branch);
  if (pr?.state === "MERGED" && pr.mergeCommit) return pr.mergeCommit;

  const remoteHead = (await ctx.git.out(["ls-remote", "origin", `refs/heads/${branch}`])).split(
    "\t",
  )[0];
  if (!remoteHead) {
    await ctx.git.out(["push", "-q", "-u", "origin", branch]);
  } else if (remoteHead !== s.commit) {
    return stop(s, `the remote release branch moved to ${remoteHead}`);
  }
  s.publish.pushed = true;
  await save(ctx, s);

  if (!pr || pr.state === "CLOSED") {
    const bodyFile = join(statePaths(ctx.cfg).dir, "pr-body.md");
    await writeFile(bodyFile, prBody(s, await notesOf(ctx)));
    const n = await ctx.gh.createPr(branch, ctx.cfg.base, `chore(release): ${tag}`, bodyFile);
    s.publish.pr = n;
    await save(ctx, s);
  } else if (s.publish.pr !== pr.number) {
    s.publish.pr = pr.number;
    await save(ctx, s);
  }
  const n = s.publish.pr as number;

  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const v = await ctx.gh.prView(n);
    if (v.state === "MERGED" && v.mergeCommit) return v.mergeCommit;
    if (v.state === "CLOSED") return stop(s, `the release PR #${n} was closed: ${v.url}`);
    if (v.headRefOid !== s.commit) return stop(s, `the release PR head changed to ${v.headRefOid}`);
    const failed = v.checks.filter(
      (c) => c.status === "COMPLETED" && !PASSING.includes(c.conclusion ?? ""),
    );
    if (failed.length > 0) {
      return stop(s, "a PR check failed", {
        blockers: [`PR check failed: ${failed.map((c) => c.name).join(", ")}`],
        next: `see ${v.url}; a fix needs a new candidate: abandon and prepare again`,
      });
    }
    if (v.mergeStateStatus === "BEHIND")
      return stop(s, "main moved since the checks; abandon and prepare again");
    if (v.mergeStateStatus === "DIRTY")
      return stop(s, "the release PR conflicts with main; abandon and prepare again");
    const passed = new Set(
      v.checks
        .filter((c) => c.status === "COMPLETED" && PASSING.includes(c.conclusion ?? ""))
        .map((c) => c.name),
    );
    const settled =
      v.checks.every((c) => c.status === "COMPLETED") &&
      ctx.cfg.requiredChecks.every((c) => passed.has(c));
    if (settled && MERGEABLE.includes(v.mergeStateStatus)) {
      await ctx.gh.mergePr(n, s.commit);
      const merged = await ctx.gh.prView(n);
      if (merged.mergeCommit) return merged.mergeCommit;
    } else if (settled && v.mergeStateStatus === "BLOCKED") {
      return stop(s, `GitHub blocks the merge although checks passed: ${v.url}`);
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      return {
        code: 3,
        phase: s.phase,
        message: `waiting for PR #${n}: ${v.url}`,
        next: `rerun publish --tree ${s.tree}`,
      };
    }
    await Bun.sleep(Math.min(POLL_MS, left));
  }
}

export async function cmdPublish(ctx: Ctx, opts: { tree: string; wait?: number }): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 1, phase: "none", message: "no release in progress", next: "run prepare" };
  const tag = `v${s.version}`;
  if (s.kind !== "release") return stop(s, "this is a baseline; run baseline to resume it");
  if (s.phase === "published-verify-failed") {
    return stop(s, `${tag} is published but verification failed`, {
      blockers: s.verify.filter((r) => !r.ok).map((r) => `${r.route}: ${r.detail}`),
      next: "investigate; rerun verify after a fix; a corrected release is a new patch version",
    });
  }
  // A verify that never finished leaves "published" with no results; finish it instead of claiming done.
  if (s.phase === "published") {
    return s.verify.length > 0 && s.verify.every((r) => r.ok)
      ? { code: 0, phase: s.phase, message: `${tag} is published and verified` }
      : cmdVerify(ctx);
  }
  const blockers = await preflight("publish", ctx);
  if (blockers.length > 0) return stop(s, "publish is blocked", { blockers });
  if (opts.tree !== s.tree) {
    return stop(s, `the approved tree ${opts.tree} is not the candidate's tree ${s.tree}`, {
      next: "run summary, show it to the maintainer and ask again",
    });
  }
  if (!s.publish.mergeCommit) {
    if ((await ctx.git.tree("HEAD")) !== s.tree)
      return stop(s, "HEAD tree differs from the candidate");
    const notReady = summaryBlockers(s, await notesOf(ctx));
    if (notReady.length > 0)
      return stop(s, "the candidate is not ready to publish", { blockers: notReady });
    const remote = await ctx.git.remoteTag(tag);
    if (remote)
      return stop(s, `${tag} already exists on ${remote}`, {
        next: `run abandon; the next prepare needs --version above ${s.version}`,
      });
  }
  s.approvedTree = opts.tree;
  s.phase = "publishing";
  await save(ctx, s);

  let merge = s.publish.mergeCommit;
  if (!merge) {
    const merged = await mergeRelease(ctx, s, opts.wait ?? 480);
    if (typeof merged !== "string") return merged;
    merge = merged;
    s.publish.mergeCommit = merge;
    await save(ctx, s);
  }
  await ctx.git.out(["fetch", "-q", "origin", "--tags"]);
  if ((await ctx.git.tree(merge)) !== s.tree) {
    return stop(s, "the merge commit's tree differs from the checked tree; nothing was tagged", {
      next: `run abandon; main now carries the bump, so the next prepare needs --version above ${s.version}`,
    });
  }
  const tagged = await pushTag(ctx, s, merge);
  if (tagged) return tagged;
  const released = await ensureRelease(ctx, s);
  if (released) return released;
  s.phase = "published";
  await save(ctx, s);
  return cmdVerify(ctx);
}
