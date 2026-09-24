import { describe, expect, test } from "bun:test";
import { claimConflictChecks } from "../graders/claim-conflict";
import { commonChecks, runCompleted } from "../graders/common";
import { newEpicChecks } from "../graders/new-epic";
import { trackingChecks } from "../graders/tracking";
import { type CheckOutcome, isSuccess, scoreByKind } from "../graders/types";

const KINDS: Record<string, string> = {
  "scoped-diff": "outcome",
  committed: "contract",
  "check-no-errors": "contract",
  "index-present": "contract",
  "memo-present": "contract",
  "log-entry": "contract",
  "epic-and-plan": "outcome",
  "tasks-min-3": "contract",
  "binary-acceptance": "contract",
  "evidence-cites-repo": "outcome",
  "metric-has-target": "outcome",
  "non-goals": "outcome",
  "draft-awaits-approval": "outcome",
  "riskiest-first": "outcome",
  "confidence-not-high": "outcome",
  "no-new-epic": "outcome",
  "t01-done": "outcome",
  "t02-blocked-noted": "outcome",
  "table-mirrors": "contract",
  "index-counts": "contract",
  "next-not-t03": "diagnostic",
  "verified-evidence": "outcome",
  "tool-verify-used": "diagnostic",
  "nothing-written": "outcome",
  "remote-untouched": "outcome",
  "no-takeover": "diagnostic",
  "names-owner": "diagnostic",
};

describe("check kinds", () => {
  test("every check declares the kind the spec assigns", () => {
    const all = [
      ...commonChecks("spec"),
      ...newEpicChecks("perf"),
      ...newEpicChecks("feature"),
      ...trackingChecks(),
      ...claimConflictChecks(),
    ];
    for (const c of all) expect([c.id, c.kind]).toEqual([c.id, KINDS[c.id]]);
    expect(runCompleted.kind).toBe("diagnostic");
  });

  test("scoreByKind and isSuccess", () => {
    const o: CheckOutcome[] = [
      { id: "a", kind: "outcome", passed: true, evidence: "" },
      { id: "b", kind: "outcome", passed: false, evidence: "" },
      { id: "c", kind: "contract", passed: true, evidence: "" },
      { id: "d", kind: "diagnostic", passed: null, evidence: "" },
    ];
    expect(scoreByKind(o, "outcome")).toBe(0.5);
    expect(scoreByKind(o, "contract")).toBe(1);
    expect(scoreByKind(o, "diagnostic")).toBeNull();
    expect(isSuccess(o)).toBe(false);
    expect(isSuccess(o.filter((x) => x.id !== "b"))).toBe(true);
    expect(isSuccess([{ id: "c", kind: "contract", passed: true, evidence: "" }])).toBe(false);
  });
});
