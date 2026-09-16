import type { FixtureInfo } from "../fixture";
import type { Check } from "../graders/types";

export type Condition = "with-skill" | "without-skill";
export const CONDITIONS: Condition[] = ["with-skill", "without-skill"];

export interface Scenario {
  name: string;
  /** The request itself, ending with CONTRACT_SENTENCE; never mentions pmanager. */
  task: string;
  graderVersion: number;
  buildFixture(dir: string): Promise<FixtureInfo>;
  checks: Check[];
}

export const SKILL_PREFIX = "Use the pmanager skill. ";
export const CONTRACT_SENTENCE = "Planning documents follow the format in docs/pm/CONTRACT.md.";

export function composePrompt(scenario: Scenario, condition: Condition): string {
  return condition === "with-skill" ? `${SKILL_PREFIX}${scenario.task}` : scenario.task;
}
