import type { Adapter } from "./types";

const REASON =
  "copilot adapter not implemented: Copilot CLI's JSONL output schema is undocumented; parse ~/.copilot/session-state/<id>/events.jsonl in bench/adapters/copilot.ts once verified";

export const copilot: Adapter = {
  name: "copilot",
  defaultModel: undefined,
  envPassthrough: ["GITHUB_TOKEN", "COPILOT_HOME"],
  async isolate() {
    return null;
  },
  async detect() {
    return { available: false, reason: REASON };
  },
  async run() {
    throw new Error(REASON);
  },
};
