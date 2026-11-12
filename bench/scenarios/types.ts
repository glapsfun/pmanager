import type { FixtureInfo } from "../fixture";
import type { Check } from "../graders/types";

export type Condition = "with-skill" | "without-skill" | "baseline-skill";
export const CONDITIONS: Condition[] = ["with-skill", "without-skill"];
export const BASELINE_CONDITIONS: Condition[] = ["with-skill", "baseline-skill"];

export function hasSkill(condition: Condition): boolean {
  return condition !== "without-skill";
}

export interface Scenario {
  name: string;
  /** The request itself, ending with CONTRACT_SENTENCE; never mentions pmanager. */
  task: string;
  graderVersion: number;
  buildFixture(dir: string): Promise<FixtureInfo>;
  /**
   * Runs after the fixture-hash check and before the skill is installed, so a condition can
   * see a different fixture (the baseline arm without what the change under test writes).
   */
  prepareCondition?(dir: string, condition: Condition, info: FixtureInfo): Promise<FixtureInfo>;
  checks: Check[];
  /** the run gets no package registry and no web tools (see bench/offline.ts) */
  offline?: boolean;
}

export const SKILL_PREFIX = "Use the pmanager skill. ";
export const CONTRACT_SENTENCE =
  "Planning documents follow the format in docs/pm/CONTRACT.md. Pass --no-worktree to every pm claim and pm release so the work stays in this checkout.";

export function composePrompt(scenario: Scenario, condition: Condition): string {
  return hasSkill(condition) ? `${SKILL_PREFIX}${scenario.task}` : scenario.task;
}
