import { join } from "node:path";
import type { Ctx } from "../gate";
import { PACKAGES } from "../packages";
import { capture } from "../proc";

export type AuditKind =
  | { kind: "clean" }
  | { kind: "findings"; packages: string[] }
  | { kind: "unreachable"; detail: string };

type Advisory = { severity: string };

const isAdvisoryList = (v: unknown): v is Advisory[] =>
  Array.isArray(v) &&
  v.every((a) => typeof a === "object" && a !== null && typeof a.severity === "string");

/** Classifies `bun audit --json` output by advisory severity (high and critical only); anything but a map of advisory lists is unreachable. */
export function classifyAudit(stdout: string): AuditKind {
  const unreachable: AuditKind = { kind: "unreachable", detail: stdout.trim().slice(0, 200) };
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return unreachable;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return unreachable;
  const entries = Object.entries(data);
  if (!entries.every(([, advisories]) => isAdvisoryList(advisories))) return unreachable;
  const packages = (entries as [string, Advisory[]][])
    .filter(([, advisories]) =>
      advisories.some((a) => a.severity === "high" || a.severity === "critical"),
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
export async function auditCheck(ctx: Ctx, run: typeof capture = capture): Promise<boolean> {
  let ok = true;
  for (const p of PACKAGES) {
    const out = await run(["bun", "audit", "--json"], join(ctx.root, p.dir));
    const kind = classifyAudit(out.stdout);
    const outcome = auditOutcome(kind, ctx.ci);
    if (kind.kind === "findings") {
      console.error(`audit: ${p.name} high or critical advisories in: ${kind.packages.join(", ")}`);
    } else if (kind.kind === "unreachable") {
      const detail = [kind.detail, out.stderr.trim()].filter(Boolean).join("\n");
      if (outcome === "fail") {
        console.error(`audit: ${p.name} could not reach the advisory service\n${detail}`);
      } else {
        console.warn(
          `audit: ${p.name} could not reach the advisory service; CI will check\n${detail}`,
        );
      }
    }
    if (outcome === "fail") ok = false;
  }
  return ok;
}
