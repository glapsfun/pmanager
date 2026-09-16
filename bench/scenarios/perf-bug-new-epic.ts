import { rm } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { type FixtureInfo, gitCommitAll, headSha } from "../fixture";
import { commonChecks } from "../graders/common";
import { newEpicChecks } from "../graders/new-epic";
import { type Scenario, SKILL_PREFIX } from "./types";

export async function buildNewEpicFixture(dir: string): Promise<FixtureInfo> {
  await buildWebshopRepo(dir);
  await rm(join(dir, "docs", "pm"), { recursive: true, force: true });
  await gitCommitAll(dir, "chore: drop docs/pm");
  return {
    baselineSha: await headSha(dir),
    originBare: null,
    originRefs: {},
    epicSlugsBefore: [],
    initialDirty: {},
  };
}

export const perfBugNewEpic: Scenario = {
  name: "perf-bug-new-epic",
  prompt: `${SKILL_PREFIX}We have a performance problem in our app: the orders page got really slow for customers sometime in July. Plan out the work to fix this properly. I'm heading into meetings, so make reasonable assumptions where you'd normally ask me.`,
  buildFixture: buildNewEpicFixture,
  checks: [...commonChecks("spec"), ...newEpicChecks("perf")],
};
