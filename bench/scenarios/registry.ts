import { featureIdeaEpic } from "./feature-idea-epic";
import { memoryRecall } from "./memory-recall";
import { multiRepoContext } from "./multi-repo-context";
import { multiRepoContextAsIs } from "./multi-repo-context-asis";
import { multiStackRepo } from "./multi-stack-repo";
import { perfBugNewEpic } from "./perf-bug-new-epic";
import { planningTraps } from "./planning-traps";
import { trackingUpdateMemory } from "./tracking-update-memory";
import { twoSessionClaimConflict } from "./two-session-claim-conflict";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [
  perfBugNewEpic,
  featureIdeaEpic,
  trackingUpdateMemory,
  twoSessionClaimConflict,
  planningTraps,
];

/** Reachable by name for experiments, but kept out of SCENARIOS, which every release e2e run iterates. */
export const MEASUREMENT_SCENARIOS: Scenario[] = [
  memoryRecall,
  multiRepoContext,
  multiRepoContextAsIs,
  multiStackRepo,
];

export function scenarioByName(name: string): Scenario | undefined {
  return [...SCENARIOS, ...MEASUREMENT_SCENARIOS].find((s) => s.name === name);
}
