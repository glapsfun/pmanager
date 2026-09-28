import { buildNoisyRepo } from "./build-noisy";
import { buildWebshopRepo } from "./build-webshop";

export interface ResearchFixture {
  name: string;
  keywords: string[];
  /** substrings pruning must never remove at the default budget */
  mustKeep: string[];
  build(dir: string): Promise<void>;
}

export const RESEARCH_FIXTURES: ResearchFixture[] = [
  {
    name: "webshop",
    keywords: ["orders", "pagination", "slow"],
    mustKeep: ["[app/app.py:14]", "remove pagination from /orders"],
    build: (dir) => buildWebshopRepo(dir, { withPmDocs: false }),
  },
  {
    name: "noisy",
    keywords: ["invoice", "retry"],
    mustKeep: [
      "[src/billing/invoice.ts:3] export function retryInvoice",
      "fix: retry invoice export on timeout",
    ],
    build: buildNoisyRepo,
  },
];
