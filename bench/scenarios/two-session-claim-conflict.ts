import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gitOk } from "../../plugins/pmanager/skills/pmanager/scripts/git";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { type FixtureInfo, headSha, lsRemoteRefs } from "../fixture";
import { claimConflictChecks } from "../graders/claim-conflict";
import { type Scenario, SKILL_PREFIX } from "./types";

export const twoSessionClaimConflict: Scenario = {
  name: "two-session-claim-conflict",
  prompt: `${SKILL_PREFIX}Plan the work to fix the orders page performance as an epic. I'm on the pi harness (pass --harness pi to the pm tool). Assume reasonable answers, I'm not available.`,
  async buildFixture(dir: string): Promise<FixtureInfo> {
    await buildWebshopRepo(dir);
    const bare = join(dirname(dir), `${basename(dir)}-origin.git`);
    await mkdir(bare, { recursive: true });
    await gitOk(["init", "-q", "--bare", "-b", "main"], bare);
    await gitOk(["remote", "add", "origin", bare], dir);
    await gitOk(["push", "-q", "origin", "main"], dir);
    await gitOk(["push", "-q", "origin", "main:pm/app-performance"], dir);
    await gitOk(["fetch", "-q", "origin"], dir);
    return {
      baselineSha: await headSha(dir),
      originBare: bare,
      originRefs: await lsRemoteRefs(dir, "origin"),
      epicSlugsBefore: ["app-performance"],
      ignorePaths: [],
    };
  },
  checks: claimConflictChecks(),
};
