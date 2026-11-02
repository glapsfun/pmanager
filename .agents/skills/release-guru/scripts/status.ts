import type { Ctx, Result } from "./context";
import { type Phase, pidAlive, type ReleaseState, readState } from "./state";

const CANDIDATE: readonly Phase[] = ["prepared", "checked", "blocked", "approved"];

/** What the maintainer or agent should do next in a phase. */
export function nextStep(s: ReleaseState, checksRunning: boolean): string {
  if (checksRunning) return "checks are running: run wait";
  switch (s.phase) {
    case "prepared":
      return "rewrite the notes for users if not done yet, then run check";
    case "checked":
      return "run summary, show it to the maintainer, and publish --tree <tree> after their yes";
    case "blocked":
      return "fix the blockers and run check again, or run abandon";
    case "approved":
    case "publishing":
      return `run publish --tree ${s.tree} to resume`;
    case "published":
      return s.verify.length > 0 ? "done" : "run verify";
    case "published-verify-failed":
      return "investigate the failed routes; rerun verify after a fix; a corrected release is a new patch version";
  }
}

async function attempt<T>(f: () => Promise<T>): Promise<T | string> {
  try {
    return await f();
  } catch (e) {
    return `unavailable: ${(e as Error).message.split("\n")[0]}`;
  }
}

/** Read-only: the saved state next to what git and GitHub say now. */
export async function cmdStatus(ctx: Ctx): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 0, phase: "none", message: "no release in progress", next: "run prepare" };
  const tag = `v${s.version}`;
  const headTree = await ctx.git.tree("HEAD");
  const remoteBranch = s.branch
    ? (await ctx.git.out(["ls-remote", "origin", `refs/heads/${s.branch}`])).split("\t")[0] || null
    : null;
  const pr = s.branch ? await attempt(() => ctx.gh.findPr(s.branch as string)) : null;
  const release = await attempt(() => ctx.gh.release(tag));
  const checksRunning = s.checksPid !== undefined && pidAlive(s.checksPid);
  const reality = {
    branch: await ctx.git.branch(),
    headTree,
    remoteBranch,
    pr: pr && typeof pr === "object" ? { number: pr.number, state: pr.state, url: pr.url } : pr,
    remoteTag: await ctx.git.remoteTag(tag),
    release:
      release && typeof release === "object"
        ? { url: release.url, latest: release.latest }
        : release,
    checksRunning,
  };
  const blockers = [...s.blockers];
  if (CANDIDATE.includes(s.phase) && headTree !== s.tree) {
    blockers.push("HEAD tree differs from the prepared candidate");
  }
  if (s.checksPid !== undefined && !checksRunning) {
    blockers.push(`checks process ${s.checksPid} is gone without a result`);
  }
  return {
    code: blockers.length > 0 ? 1 : 0,
    phase: s.phase,
    message: `${tag}: ${s.phase}`,
    next: nextStep(s, checksRunning),
    ...(blockers.length > 0 ? { blockers } : {}),
    data: {
      version: s.version,
      previousTag: s.previousTag,
      branch: s.branch,
      commit: s.commit,
      tree: s.tree,
      publish: s.publish,
      reality,
    },
  };
}
