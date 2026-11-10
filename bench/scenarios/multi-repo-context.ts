import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daysBetween, shiftDates } from "../../ci/e2e/dates";
import { pmProcess } from "../../ci/e2e/pm";
import { CLAIMS, playSteps, REGISTRY, STORY_END } from "../../ci/e2e/story";
import { buildBaseAt, gitDateEnv, sh } from "../../ci/e2e/workspace";
import { type FixtureInfo, headSha, lsRemoteRefs } from "../fixture";
import { commonChecks } from "../graders/common";
import { multiRepoContextChecks } from "../graders/multi-repo-context";
import { binaryAcceptance, draftAwaitsApproval, epicAndPlan, tasksMin3 } from "../graders/new-epic";
import { PM_TODAY } from "../skill-paths";
import { CONTRACT_SENTENCE, type Scenario } from "./types";

const MEMO = join(import.meta.dir, "multi-repo-context-memo.md");

export const MULTI_REPO_REQUEST = `We want to try webshop releases on a small share of real traffic before they reach everyone. Add a canary path: the service should report which version it runs, the cluster should run a canary next to the current webshop, and the canary gets its own load balancer and test hostname so the team can reach it directly before any real traffic goes there. Then send 10% of real traffic to it. Plan this as one epic with a plan and tasks the team can start next sprint. I won't be around for questions, note your assumptions. ${CONTRACT_SENTENCE}`;

/**
 * The example workspace with no target fact outside the target repos: the
 * catalog and two claims, but neither story epic, and a memo whose
 * conventions name only the manager's own checks (the cold case profiles
 * would serve). The fixture dir is the manager; the rest lives in
 * `<dir>-pm-workspace`, which the bench's fixture cleanup removes.
 */
async function coldFixture(dir: string): Promise<FixtureInfo> {
  // Claim dates must end on the bench's day, or the codex claim would not be stale.
  const shiftDays = daysBetween(STORY_END, PM_TODAY);
  const ws = await buildBaseAt(dir, { shiftDays });
  await playSteps(ws, [...REGISTRY, ...CLAIMS], { shiftDays });
  const memo = shiftDates(await readFile(MEMO, "utf8"), shiftDays);
  await writeFile(join(dir, "docs", "pm", "pmanager-memo.md"), memo);
  const render = await pmProcess(dir, ["render"], { env: { PM_TODAY } });
  if (render.code !== 0) throw new Error(`pm render failed: ${render.stderr}`);
  await sh(["git", "add", "docs/pm"], dir);
  await sh(["git", "commit", "-q", "-m", "docs(pm): product memo"], dir, gitDateEnv(PM_TODAY));
  await sh(["git", "push", "-q", "origin", "main"], dir);
  return {
    baselineSha: await headSha(dir),
    originBare: ws.remote,
    originRefs: await lsRemoteRefs(dir, "origin"),
    epicSlugsBefore: [],
    initialDirty: {},
  };
}

/**
 * Bench fixtures carry no extracted profile, in any commit, branch or worktree, so the arms of a
 * paired run start equal; a scenario adds profiles per condition in prepareCondition.
 */
export async function withoutProfiles<T>(build: () => Promise<T>): Promise<T> {
  const before = process.env.PM_NO_PROFILES;
  process.env.PM_NO_PROFILES = "1";
  try {
    return await build();
  } finally {
    if (before === undefined) delete process.env.PM_NO_PROFILES;
    else process.env.PM_NO_PROFILES = before;
  }
}

export function buildMultiRepoContextFixture(dir: string): Promise<FixtureInfo> {
  return withoutProfiles(() => coldFixture(dir));
}

export const multiRepoContext: Scenario = {
  name: "multi-repo-context",
  task: MULTI_REPO_REQUEST,
  graderVersion: 5,
  buildFixture: buildMultiRepoContextFixture,
  checks: [
    ...commonChecks("spec"),
    epicAndPlan,
    tasksMin3,
    binaryAcceptance,
    draftAwaitsApproval,
    ...multiRepoContextChecks(),
  ],
};
