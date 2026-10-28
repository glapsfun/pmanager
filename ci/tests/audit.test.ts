import { expect, test } from "bun:test";
import { auditOutcome, classifyAudit } from "../checks/audit";

test("classifyAudit", () => {
  expect(classifyAudit("{}")).toEqual({ kind: "clean" });
  expect(classifyAudit('{"a":[{"severity":"moderate"}]}')).toEqual({ kind: "clean" });
  expect(classifyAudit('{"a":[{"severity":"high"}],"b":[{"severity":"critical"}]}')).toEqual({
    kind: "findings",
    packages: ["a", "b"],
  });
  expect(classifyAudit("error: ConnectionRefused").kind).toBe("unreachable");
  expect(classifyAudit("[]").kind).toBe("unreachable");
});

test("auditOutcome", () => {
  const unreachable = { kind: "unreachable", detail: "x" } as const;
  expect(auditOutcome(unreachable, false)).toBe("warn");
  expect(auditOutcome(unreachable, true)).toBe("fail");
  expect(auditOutcome({ kind: "findings", packages: ["a"] }, false)).toBe("fail");
  expect(auditOutcome({ kind: "clean" }, true)).toBe("pass");
});
