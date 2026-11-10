import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daysBetween, shiftDates } from "../../ci/e2e/dates";
import { pmProcess } from "../../ci/e2e/pm";
import { STORY_END } from "../../ci/e2e/story";
import { BASE_DAY, gitDateEnv, sh } from "../../ci/e2e/workspace";
import { type FixtureInfo, headSha, lsRemoteRefs } from "../fixture";
import { commonChecks } from "../graders/common";
import { multiStackRepoChecks, ORDERS_URL } from "../graders/multi-stack-repo";
import { binaryAcceptance, draftAwaitsApproval, epicAndPlan, tasksMin3 } from "../graders/new-epic";
import { PM_TODAY } from "../skill-paths";
import { buildMultiRepoContextFixture, withoutProfiles } from "./multi-repo-context";
import { CONTRACT_SENTENCE, type Condition, type Scenario } from "./types";

const ORDERS = join(import.meta.dir, "fixtures", "orders");
// The example's own author, so two builds give the same orders commit.
const AUTHOR = ["-c", "user.name=pm-example", "-c", "user.email=pm-example@example.invalid"];

export const MULTI_STACK_REQUEST = `The orders service should let customers export their order history as a CSV file. It should work asynchronously: a customer asks for an export, gets an answer straight away, and downloads the file once it is ready. Export files live in their own storage, apart from the order data, and are deleted 30 days from when they are made. Plan this as one epic with a plan and tasks the team can start next sprint. I won't be around for questions, note your assumptions. ${CONTRACT_SENTENCE}`;

/**
 * The cold multi-repo-context fixture plus `orders`, a monorepo whose Terraform
 * and chart keep their commands in their own folder doc and CI job. It lives
 * beside the other targets in `<dir>-pm-workspace`, mapped and registered.
 */
export function buildMultiStackRepoFixture(dir: string): Promise<FixtureInfo> {
  return withoutProfiles(() => multiStackFixture(dir));
}

async function multiStackFixture(dir: string): Promise<FixtureInfo> {
  const base = await buildMultiRepoContextFixture(dir);
  const orders = `${dir}-pm-workspace/orders`;
  await cp(ORDERS, orders, { recursive: true });
  const created = gitDateEnv(shiftDates(BASE_DAY, daysBetween(STORY_END, PM_TODAY)));
  await sh(["git", "init", "-q", "-b", "main"], orders);
  await sh(["git", "add", "-A"], orders);
  await sh(["git", ...AUTHOR, "commit", "-q", "-m", "chore: initial orders"], orders, created);
  await sh(["git", "remote", "add", "origin", ORDERS_URL], orders);

  const mapPath = join(dir, "docs", "pm", ".local", "repos.json");
  const map = JSON.parse(await readFile(mapPath, "utf8")) as Record<string, string>;
  await writeFile(mapPath, `${JSON.stringify({ ...map, [ORDERS_URL]: orders }, null, 2)}\n`);
  for (const args of [["project", "add", orders], ["render"]]) {
    const r = await pmProcess(dir, args, { env: { PM_TODAY } });
    if (r.code !== 0) throw new Error(`pm ${args.join(" ")} failed: ${r.stderr}`);
  }
  await sh(["git", "add", "docs/pm"], dir);
  await sh(["git", "commit", "-q", "-m", "docs(pm): register orders"], dir, gitDateEnv(PM_TODAY));
  await sh(["git", "push", "-q", "origin", "main"], dir);
  return {
    ...base,
    baselineSha: await headSha(dir),
    originRefs: await lsRemoteRefs(dir, "origin"),
  };
}

/** Only the change's arm gets profiles: the shared build has none, and main's skill writes none. */
async function prepareMultiStackCondition(
  dir: string,
  condition: Condition,
  info: FixtureInfo,
): Promise<FixtureInfo> {
  if (condition !== "with-skill") return info;
  const r = await pmProcess(dir, ["project", "refresh"], { env: { PM_TODAY, PM_NO_PROFILES: "" } });
  if (r.code !== 0) throw new Error(`pm project refresh failed: ${r.stderr}`);
  await sh(["git", "add", "docs/pm/projects"], dir);
  await sh(["git", "commit", "-q", "-m", "docs(pm): project profiles"], dir, gitDateEnv(PM_TODAY));
  await sh(["git", "push", "-q", "origin", "main"], dir);
  return {
    ...info,
    baselineSha: await headSha(dir),
    originRefs: await lsRemoteRefs(dir, "origin"),
  };
}

export const multiStackRepo: Scenario = {
  name: "multi-stack-repo",
  task: MULTI_STACK_REQUEST,
  graderVersion: 2,
  buildFixture: buildMultiStackRepoFixture,
  prepareCondition: prepareMultiStackCondition,
  checks: [
    ...commonChecks("spec"),
    epicAndPlan,
    tasksMin3,
    binaryAcceptance,
    draftAwaitsApproval,
    ...multiStackRepoChecks(),
  ],
};
