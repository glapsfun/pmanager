import type { Ctx, Result } from "./context";
import { preflight } from "./preflight";
import { clearState, readState } from "./state";

export async function cmdAbandon(ctx: Ctx): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 0, phase: "none", message: "no release in progress" };
  const blockers = await preflight("abandon", ctx);
  if (blockers.length > 0)
    return { code: 1, phase: s.phase, message: "abandon is blocked", blockers };
  const tag = `v${s.version}`;
  if (await ctx.git.remoteTag(tag)) {
    return {
      code: 1,
      phase: s.phase,
      message: `${tag} is already published; a correction is a new patch release`,
    };
  }
  if (s.branch) {
    const pr = await ctx.gh.findPr(s.branch);
    // The version bump is on main once merged, so only publishing can finish it consistently.
    if (pr?.state === "MERGED") {
      return {
        code: 1,
        phase: s.phase,
        message: `the release PR #${pr.number} was merged; finish with publish instead`,
      };
    }
    if (pr?.state === "OPEN") await ctx.gh.closePr(pr.number, "Abandoned by release-guru.");
    if (await ctx.git.out(["ls-remote", "origin", `refs/heads/${s.branch}`])) {
      await ctx.git.out(["push", "-q", "origin", "--delete", s.branch]);
    }
    if ((await ctx.git.branch()) === s.branch) await ctx.git.out(["switch", "-q", ctx.cfg.base]);
    if (await ctx.git.ok(["rev-parse", "--verify", "--quiet", `refs/heads/${s.branch}`])) {
      await ctx.git.out(["branch", "-q", "-D", s.branch]);
    }
  }
  await clearState(ctx.cfg);
  return { code: 0, phase: "none", message: `abandoned ${tag}`, next: "run prepare when ready" };
}
