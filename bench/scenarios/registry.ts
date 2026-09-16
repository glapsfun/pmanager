import { featureIdeaEpic } from "./feature-idea-epic";
import { perfBugNewEpic } from "./perf-bug-new-epic";
import { trackingUpdateMemory } from "./tracking-update-memory";
import { twoSessionClaimConflict } from "./two-session-claim-conflict";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [
  perfBugNewEpic,
  featureIdeaEpic,
  trackingUpdateMemory,
  twoSessionClaimConflict,
];

export function scenarioByName(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
