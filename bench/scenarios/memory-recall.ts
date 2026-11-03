import { commonChecks } from "../graders/common";
import { memoryRecallChecks, newSpecLog } from "../graders/memory-recall";
import { binaryAcceptance, draftAwaitsApproval, epicAndPlan, tasksMin3 } from "../graders/new-epic";
import { buildMemoryRecallFixture } from "./memory-recall-fixture";
import { CONTRACT_SENTENCE, type Scenario } from "./types";

export const memoryRecall: Scenario = {
  name: "memory-recall",
  task: `Shoppers keep asking us to tell them when sold-out items come back. Add a "notify me" option on sold-out product pages and email those shoppers when the item is restocked. Start with a small share of shoppers before turning it on for everyone. Plan this as one epic with a plan and tasks the team can start next sprint. I won't be around for questions, note your assumptions. ${CONTRACT_SENTENCE}`,
  graderVersion: 1,
  buildFixture: buildMemoryRecallFixture,
  checks: [
    ...commonChecks("spec"),
    newSpecLog,
    epicAndPlan,
    tasksMin3,
    binaryAcceptance,
    draftAwaitsApproval,
    ...memoryRecallChecks(),
  ],
};
