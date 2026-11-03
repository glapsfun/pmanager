import type { Ctx, Result } from "./context";
import { preflight } from "./preflight";
import { clearState, readState } from "./state";

/** Drops an unpublished candidate, touching only remote work that is this candidate's own. */
export async function cmdAbandon(ctx: Ctx): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 0, phase: "none", message: "no release in progress" };
  const blockers = await preflight("abandon", ctx);
  if (blockers.length > 0)
    return { code: 1, phase: s.phase, message: "abandon is blocked", blockers };
  const tag = `v${s.version}`;
  const taken = await ctx.git.remoteTag(tag);
  const releasedCommit = s.kind === "baseline" ? s.commit : s.publish.mergeCommit;
  if (s.publish.released || (taken !== null && taken === releasedCommit)) {
    return {
      code: 1,
      phase: s.phase,
      message: `${tag} is already published; a correction is a new patch release`,
    };
  }
  const notes: string[] = [];
  if (taken)
    notes.push(
      `that version is taken on origin by ${taken}, so the next prepare needs --version above it`,
    );
  if (s.branch) {
    const pr = await ctx.gh.findPr(s.branch);
    if (pr?.state === "MERGED" && pr.mergeCommit) {
      const sameTree = (await ctx.git.tree(pr.mergeCommit)) === s.tree;
      // Publish can still tag this merge; abandoning it would strand a good release.
      if (sameTree && !taken) {
        return {
          code: 1,
          phase: s.phase,
          message: `the release PR #${pr.number} was merged; finish with publish instead`,
        };
      }
      notes.push(
        `main carries its version bump from PR #${pr.number} without a tag, so the next prepare needs --version above ${s.version}`,
      );
    }
    // Publish records the PR only after it saw the branch at this candidate's commit, so a PR
    // with that number stays ours after GitHub's "Update branch" or a push moves its head.
    const ownPr = pr !== null && (pr.headRefOid === s.commit || pr.number === s.publish.pr);
    if (pr?.state === "OPEN") {
      if (ownPr) await ctx.gh.closePr(pr.number, "Abandoned by release-guru.");
      else
        notes.push(
          `PR #${pr.number} points at ${pr.headRefOid}, not this candidate, so it was left alone; close it on GitHub if nobody needs it`,
        );
    }
    const remoteHead = (await ctx.git.out(["ls-remote", "origin", `refs/heads/${s.branch}`])).split(
      "\t",
    )[0];
    if (remoteHead === s.commit || (ownPr && remoteHead === pr?.headRefOid)) {
      await ctx.git.out(["push", "-q", "origin", "--delete", s.branch]);
    } else if (remoteHead) {
      notes.push(
        `origin/${s.branch} points at ${remoteHead}, not this candidate, so it was left alone; delete it on GitHub if nobody needs it`,
      );
    }
    if ((await ctx.git.branch()) === s.branch) await ctx.git.out(["switch", "-q", ctx.cfg.base]);
    if (await ctx.git.ok(["rev-parse", "--verify", "--quiet", `refs/heads/${s.branch}`])) {
      await ctx.git.out(["branch", "-q", "-D", s.branch]);
    }
  }
  await clearState(ctx.cfg);
  return {
    code: 0,
    phase: "none",
    message: [`abandoned ${tag}`, ...notes].join("; "),
    next: "run prepare when ready",
  };
}
