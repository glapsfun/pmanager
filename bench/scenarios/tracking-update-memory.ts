import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { type FixtureInfo, headSha, snapshotDirty } from "../fixture";
import { commonChecks } from "../graders/common";
import { trackingChecks } from "../graders/tracking";
import { type Scenario, SKILL_PREFIX } from "./types";

const PROFILE = `GET /orders profile (1000 orders, 10 items each, 20 requests)
p50 2.9s  p95 3.4s
~85% of request time spent in per-order item queries (SELECT * FROM order_items WHERE order_id = ?)
`;

export const trackingUpdateMemory: Scenario = {
  name: "tracking-update-memory",
  prompt: `${SKILL_PREFIX}Quick update on the performance work: T01 is done, profile results landed in docs/profile-results.txt and they show ~85% of request time in per-order item queries. Also T02 is blocked, waiting on DBA review. Update our tracking and tell me what we should pick up next.`,
  async buildFixture(dir: string): Promise<FixtureInfo> {
    await buildWebshopRepo(dir);
    await writeFile(join(dir, "docs", "profile-results.txt"), PROFILE);
    return {
      baselineSha: await headSha(dir),
      originBare: null,
      originRefs: {},
      epicSlugsBefore: ["app-performance"],
      initialDirty: await snapshotDirty(dir),
    };
  },
  checks: [...commonChecks("update"), ...trackingChecks()],
};
