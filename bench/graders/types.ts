import type { Finding } from "../../plugins/pmanager/skills/pmanager/scripts/findings";
import type { PmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import type { Telemetry } from "../adapters/types";

export interface CheckResult {
  passed: boolean | null;
  evidence: string;
}

export interface CheckContext {
  fixtureDir: string;
  baselineSha: string;
  originBare: string | null;
  originRefs: Record<string, string>;
  epicSlugsBefore: string[];
  repo: PmRepo | null;
  findings: Finding[];
  changedPaths: string[];
  newCommits: number;
  dirty: boolean;
  telemetry: Telemetry;
}

export interface Check {
  id: string;
  description: string;
  run(ctx: CheckContext): Promise<CheckResult>;
}

export interface CheckOutcome {
  id: string;
  passed: boolean | null;
  evidence: string;
}

export interface Score {
  score: number;
  failed: string[];
  skipped: string[];
  outcomes: CheckOutcome[];
}

export async function runChecks(checks: Check[], ctx: CheckContext): Promise<CheckOutcome[]> {
  const out: CheckOutcome[] = [];
  for (const c of checks) {
    try {
      const r = await c.run(ctx);
      out.push({ id: c.id, passed: r.passed, evidence: r.evidence });
    } catch (e) {
      out.push({ id: c.id, passed: false, evidence: `check threw: ${(e as Error).message}` });
    }
  }
  return out;
}

export function scoreChecks(outcomes: CheckOutcome[]): Score {
  const failed = outcomes.filter((o) => o.passed === false).map((o) => o.id);
  const skipped = outcomes.filter((o) => o.passed === null).map((o) => o.id);
  const scored = outcomes.length - skipped.length;
  const passed = outcomes.filter((o) => o.passed === true).length;
  return { score: scored === 0 ? 0 : passed / scored, failed, skipped, outcomes };
}
