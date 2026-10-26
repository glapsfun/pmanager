import { describe, expect, test } from "bun:test";
import { newSessionId, ownershipProblem } from "../scripts/session";

const legacy = { harness: "claude-code", claimed: "2026-09-10", branch: "pm/x" };
const withId = { ...legacy, id: "a1b2c3" };

describe("newSessionId", () => {
  test("six lowercase hex digits, different each time", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newSessionId()));
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{6}$/);
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("ownershipProblem", () => {
  test("a claim with an id accepts only that id, whatever the harness", () => {
    expect(ownershipProblem(withId, "claude-code", "a1b2c3")).toBeNull();
    expect(ownershipProblem(withId, "pi", "a1b2c3")).toBeNull();
    const none = ownershipProblem(withId, "claude-code");
    expect(none).toContain("owned by claude-code (claimed 2026-09-10, session a1b2c3)");
    expect(none).toContain("not your session (none given)");
    expect(ownershipProblem(withId, "claude-code", "ffffff")).toContain("not your session ffffff");
  });

  test("an older claim without an id keeps the harness rule", () => {
    expect(ownershipProblem(legacy, "claude-code")).toBeNull();
    expect(ownershipProblem(legacy, "pi")).toContain(
      "owned by claude-code (claimed 2026-09-10), not pi",
    );
  });

  test("the refusal names the three ways forward", () => {
    const msg = ownershipProblem(withId, "pi") ?? "";
    expect(msg).toContain("ask that session to release it");
    expect(msg).toContain("claim --takeover");
    expect(msg).toContain("--force");
  });
});
