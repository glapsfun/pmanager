import type { FixtureInfo } from "../fixture";
import type { Check } from "../graders/types";

export interface Scenario {
  name: string;
  prompt: string;
  buildFixture(dir: string): Promise<FixtureInfo>;
  checks: Check[];
}

export const SKILL_PREFIX = "Use the pmanager skill. ";
