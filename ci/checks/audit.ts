import { join } from "node:path";
import type { Check } from "../gate";
import { PACKAGES } from "../packages";
import { capture } from "../proc";

export type AuditKind =
  | { kind: "clean" }
  | { kind: "findings"; packages: string[] }
  | { kind: "unreachable"; detail: string };

/** Classifies `bun audit --json` output by advisory severity (high and critical only). */
export function classifyAudit(stdout: string): AuditKind {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { kind: "unreachable", detail: stdout.trim().slice(0, 200) };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { kind: "unreachable", detail: stdout.trim().slice(0, 200) };
  }
  const packages = Object.entries(data as Record<string, unknown>)
    .filter(
      ([, advisories]) =>
        Array.isArray(advisories) &&
        advisories.some((a) => a?.severity === "high" || a?.severity === "critical"),
    )
    .map(([name]) => name);
  return packages.length > 0 ? { kind: "findings", packages } : { kind: "clean" };
}

/** Findings always fail; an unreachable service warns locally and fails in CI. */
export function auditOutcome(k: AuditKind, ci: boolean): "pass" | "warn" | "fail" {
  if (k.kind === "clean") return "pass";
  if (k.kind === "findings") return "fail";
  return ci ? "fail" : "warn";
}

/** Runs `bun audit --json` in every package. */
export const auditCheck: Check = async (ctx) => {
  let ok = true;
  for (const p of PACKAGES) {
    const run = await capture(["bun", "audit", "--json"], join(ctx.root, p.dir));
    const kind = classifyAudit(run.stdout);
    const outcome = auditOutcome(kind, ctx.ci);
    if (kind.kind === "findings") {
      console.error(`audit: ${p.name} high or critical advisories in: ${kind.packages.join(", ")}`);
    } else if (kind.kind === "unreachable") {
      const msg = `audit: ${p.name} could not reach the advisory service; CI will check`;
      if (outcome === "fail")
        console.error(`audit: ${p.name} could not reach the advisory service`);
      else console.warn(msg);
    }
    if (outcome === "fail") ok = false;
  }
  return ok;
};
