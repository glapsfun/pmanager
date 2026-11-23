import { cp } from "node:fs/promises";
import { join } from "node:path";
import { daysBetween, shiftDates } from "../../ci/e2e/dates";
import { STORY_END } from "../../ci/e2e/story";
import { BASE_DAY, gitDateEnv, sh } from "../../ci/e2e/workspace";
import type { FixtureInfo } from "../fixture";
import { commonChecks } from "../graders/common";
import { crossRepoEndpointChecks, crossRepoOutputChecks } from "../graders/cross-repo-links";
import { binaryAcceptance, draftAwaitsApproval, epicAndPlan, tasksMin3 } from "../graders/new-epic";
import { PM_TODAY } from "../skill-paths";
import { withoutProfiles } from "./multi-repo-context";
import { buildMultiStackRepoFixture } from "./multi-stack-repo";
import { prepareSecurityFixCondition } from "./security-fix";
import { CONTRACT_SENTENCE, type Scenario } from "./types";

const OVERLAY = join(import.meta.dir, "fixtures", "cross-repo-links");
// The example's own author, so two builds give the same target commits.
const AUTHOR = ["-c", "user.name=pm-example", "-c", "user.email=pm-example@example.invalid"];

const PLAN_SENTENCE =
  "Plan this as one epic with a plan and tasks the team can start next sprint. I won't be around for questions, note your assumptions.";

export const CROSS_REPO_ENDPOINT_REQUEST = `Orders is going multi-currency. In the orders service's \`GET /orders\`, replace each order's \`total_cents\` with \`total: {"amount_cents": <int>, "currency": "<ISO 4217 code>"}\`. Every existing order is in EUR. ${PLAN_SENTENCE} ${CONTRACT_SENTENCE}`;

export const CROSS_REPO_OUTPUT_REQUEST = `The assets bucket \`pm-example-webshop-assets\` that the infra repo manages has to become \`pm-example-webshop-media\`, with versioning on and noncurrent versions expiring after 90 days. S3 bucket names can't be changed in place. Delete the old bucket at the end. ${PLAN_SENTENCE} ${CONTRACT_SENTENCE}`;

/**
 * The multi-stack-repo workspace plus the two cross-repo links the requests touch: webshop
 * calls orders' GET /orders, and argocd's webshop deployment names the bucket infra creates.
 * Commit messages are neutral on purpose; no doc names either link.
 */
export function buildCrossRepoLinksFixture(dir: string): Promise<FixtureInfo> {
  return withoutProfiles(() => crossRepoLinksFixture(dir));
}

async function crossRepoLinksFixture(dir: string): Promise<FixtureInfo> {
  const base = await buildMultiStackRepoFixture(dir);
  const ws = `${dir}-pm-workspace`;
  const created = gitDateEnv(shiftDates(BASE_DAY, daysBetween(STORY_END, PM_TODAY)));
  for (const [name, message] of [
    ["webshop", "feat: order history page"],
    ["argocd", "chore(webshop): deployment settings"],
    ["infra", "feat: assets bucket"],
    ["orders", "chore(chart): service"],
  ] as const) {
    const repo = join(ws, name);
    await cp(join(OVERLAY, name), repo, { recursive: true });
    await sh(["git", "add", "-A"], repo);
    await sh(["git", ...AUTHOR, "commit", "-q", "-m", message], repo, created);
  }
  return base;
}

const common = [
  ...commonChecks("spec"),
  epicAndPlan,
  tasksMin3,
  binaryAcceptance,
  draftAwaitsApproval,
];

export const crossRepoEndpoint: Scenario = {
  name: "cross-repo-endpoint",
  task: CROSS_REPO_ENDPOINT_REQUEST,
  graderVersion: 3,
  offline: true,
  buildFixture: buildCrossRepoLinksFixture,
  prepareCondition: prepareSecurityFixCondition,
  checks: [...common, ...crossRepoEndpointChecks()],
};

export const crossRepoOutput: Scenario = {
  name: "cross-repo-output",
  task: CROSS_REPO_OUTPUT_REQUEST,
  graderVersion: 3,
  offline: true,
  buildFixture: buildCrossRepoLinksFixture,
  prepareCondition: prepareSecurityFixCondition,
  checks: [...common, ...crossRepoOutputChecks()],
};
