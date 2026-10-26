import { randomBytes } from "node:crypto";
import type { Session } from "./contract";

export function newSessionId(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Null when this caller may act on an epic `owner` holds, else the refusal. A claim with an id
 * belongs to the session holding that id; an older claim without one belongs to its harness.
 */
export function ownershipProblem(
  owner: Session,
  harness: string,
  sessionId?: string,
): string | null {
  const allowed = owner.id ? sessionId === owner.id : harness === owner.harness;
  if (allowed) return null;
  const since = owner.id ? `, session ${owner.id}` : "";
  const held = `${owner.harness} (claimed ${owner.claimed || "unknown"}${since})`;
  const caller = owner.id ? `your session ${sessionId ?? "(none given)"}` : harness;
  return [
    `owned by ${held}, not ${caller};`,
    "ask that session to release it, use claim --takeover if status shows [stale],",
    "or --force as a deliberate override",
  ].join(" ");
}
