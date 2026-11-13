import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { daysBetween, shiftDates } from "../../ci/e2e/dates";
import { pmProcess } from "../../ci/e2e/pm";
import { STORY_END } from "../../ci/e2e/story";
import { BASE_DAY, gitDateEnv, sh } from "../../ci/e2e/workspace";
import { type FixtureInfo, headSha, lsRemoteRefs } from "../fixture";
import { commonChecks } from "../graders/common";
import { binaryAcceptance, draftAwaitsApproval, epicAndPlan, tasksMin3 } from "../graders/new-epic";
import { securityFixChecks } from "../graders/security-fix";
import { PM_TODAY } from "../skill-paths";
import { withoutProfiles } from "./multi-repo-context";
import { buildMultiStackRepoFixture } from "./multi-stack-repo";
import { BASE_IMAGE, FINDINGS, STOREFRONT_URL, WORKER_URL } from "./security-fix-facts";
import { CONTRACT_SENTENCE, type Condition, hasSkill, type Scenario } from "./types";

const OVERLAY = join(import.meta.dir, "fixtures", "security-fix");
// The example's own author, so two builds give the same target commits.
const AUTHOR = ["-c", "user.name=pm-example", "-c", "user.email=pm-example@example.invalid"];

function bullet(key: string): string {
  const f = FINDINGS.find((x) => x.key === key);
  if (!f) throw new Error(`no finding ${key}`);
  if (key === "image") {
    return `- \`${f.cve}\` (${f.ecosystem}, ${f.advisory}): \`${f.pkg}\` ${BASE_IMAGE.installed} in image \`${BASE_IMAGE.image}\`, fixed in ${f.fixed}. Flagged in: the ${f.named} image.`;
  }
  return `- \`${f.advisory}\` (${f.cve}, ${f.ecosystem}): \`${f.pkg}\` ${f.affectedText}, fixed in ${f.fixed}. Flagged in: ${f.named}.`;
}

export const SECURITY_FIX_REQUEST = `Our security team's scan flagged these findings in our services:

${["npm", "go", "python", "image"].map(bullet).join("\n")}

Plan the fixes as one epic with a plan and tasks the team can start next sprint. I won't be around for questions, note your assumptions. ${CONTRACT_SENTENCE}`;

/**
 * The multi-stack-repo workspace plus the dependency trees the ticket's findings live in:
 * Go modules in orders and webshop, a storefront workload in argocd, and two new repos,
 * storefront (npm) and worker (uv). Every lockfile is a committed copy; nothing resolves here.
 */
export function buildSecurityFixFixture(dir: string): Promise<FixtureInfo> {
  return withoutProfiles(() => securityFixture(dir));
}

async function securityFixture(dir: string): Promise<FixtureInfo> {
  const base = await buildMultiStackRepoFixture(dir);
  const ws = `${dir}-pm-workspace`;
  const created = gitDateEnv(shiftDates(BASE_DAY, daysBetween(STORY_END, PM_TODAY)));
  const commit = async (repo: string, message: string) => {
    await sh(["git", "add", "-A"], repo);
    await sh(["git", ...AUTHOR, "commit", "-q", "-m", message], repo, created);
  };
  for (const [name, message] of [
    ["orders", "chore: live order status over websockets"],
    ["webshop", "chore: live cart over websockets"],
    ["argocd", "chore: storefront workload"],
  ] as const) {
    await cp(join(OVERLAY, name), join(ws, name), { recursive: true });
    await commit(join(ws, name), message);
  }
  const added: Record<string, string> = {};
  for (const [name, url] of [
    ["storefront", STOREFRONT_URL],
    ["worker", WORKER_URL],
  ] as const) {
    const repo = join(ws, name);
    await cp(join(OVERLAY, name), repo, { recursive: true });
    await sh(["git", "init", "-q", "-b", "main"], repo);
    await commit(repo, `chore: initial ${name}`);
    await sh(["git", "remote", "add", "origin", url], repo);
    added[url] = repo;
  }

  const mapPath = join(dir, "docs", "pm", ".local", "repos.json");
  const map = JSON.parse(await readFile(mapPath, "utf8")) as Record<string, string>;
  await writeFile(mapPath, `${JSON.stringify({ ...map, ...added }, null, 2)}\n`);
  for (const args of [...Object.values(added).map((p) => ["project", "add", p]), ["render"]]) {
    const r = await pmProcess(dir, args, { env: { PM_TODAY } });
    if (r.code !== 0) throw new Error(`pm ${args.join(" ")} failed: ${r.stderr}`);
  }
  await sh(["git", "add", "docs/pm"], dir);
  await sh(
    ["git", "commit", "-q", "-m", "docs(pm): register storefront and worker"],
    dir,
    gitDateEnv(PM_TODAY),
  );
  await sh(["git", "push", "-q", "origin", "main"], dir);
  return {
    ...base,
    baselineSha: await headSha(dir),
    originRefs: await lsRemoteRefs(dir, "origin"),
  };
}

/** Both skill arms run on main as a real workspace has it since #60: with profiles. */
async function prepareSecurityFixCondition(
  dir: string,
  condition: Condition,
  info: FixtureInfo,
): Promise<FixtureInfo> {
  if (!hasSkill(condition)) return info;
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

export const securityFix: Scenario = {
  name: "security-fix",
  task: SECURITY_FIX_REQUEST,
  graderVersion: 2,
  offline: true,
  buildFixture: buildSecurityFixFixture,
  prepareCondition: prepareSecurityFixCondition,
  checks: [
    ...commonChecks("spec"),
    epicAndPlan,
    tasksMin3,
    binaryAcceptance,
    draftAwaitsApproval,
    ...securityFixChecks(),
  ],
};
