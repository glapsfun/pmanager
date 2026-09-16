import { commonChecks } from "../graders/common";
import { newEpicChecks } from "../graders/new-epic";
import { buildNewEpicFixture } from "./perf-bug-new-epic";
import { type Scenario, SKILL_PREFIX } from "./types";

export const featureIdeaEpic: Scenario = {
  name: "feature-idea-epic",
  prompt: `${SKILL_PREFIX}Product wants CSV export for the orders reports; customers keep asking for it. Break this down into an epic with a plan and tasks so the team can pick it up next sprint. I won't be around for questions, note your assumptions.`,
  buildFixture: buildNewEpicFixture,
  checks: [...commonChecks("spec"), ...newEpicChecks("feature")],
};
