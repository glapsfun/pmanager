import { expect, spyOn, test } from "bun:test";
import { auditCheck, auditOutcome, classifyAudit } from "../checks/audit";

test("classifyAudit", () => {
  expect(classifyAudit("{}")).toEqual({ kind: "clean" });
  expect(classifyAudit('{"a":[{"severity":"moderate"}]}')).toEqual({ kind: "clean" });
  expect(classifyAudit('{"a":[{"severity":"high"}],"b":[{"severity":"critical"}]}')).toEqual({
    kind: "findings",
    packages: ["a", "b"],
  });
  expect(classifyAudit("error: ConnectionRefused").kind).toBe("unreachable");
  expect(classifyAudit("[]").kind).toBe("unreachable");
  expect(classifyAudit('{"error":"rate limited"}').kind).toBe("unreachable");
  expect(classifyAudit('{"a":"x"}').kind).toBe("unreachable");
  expect(classifyAudit('{"a":[{"title":"no severity"}]}').kind).toBe("unreachable");
  expect(classifyAudit('{"a":[]}')).toEqual({ kind: "clean" });
});

test("auditOutcome", () => {
  const unreachable = { kind: "unreachable", detail: "x" } as const;
  expect(auditOutcome(unreachable, false)).toBe("warn");
  expect(auditOutcome(unreachable, true)).toBe("fail");
  expect(auditOutcome({ kind: "findings", packages: ["a"] }, false)).toBe("fail");
  expect(auditOutcome({ kind: "clean" }, true)).toBe("pass");
});

test("an unreachable audit prints the output and stderr, warning locally and failing in CI", async () => {
  const lines: string[] = [];
  const push = (...a: unknown[]) => void lines.push(a.join(" "));
  const warn = spyOn(console, "warn").mockImplementation(push);
  const error = spyOn(console, "error").mockImplementation(push);
  const run = async () => ({ code: 0, stdout: '{"error":"rate limited"}', stderr: "HTTP 200\n" });
  try {
    expect(await auditCheck({ root: "/r", ci: false, args: [] }, run)).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(lines.join("\n")).toContain('{"error":"rate limited"}\nHTTP 200');
    lines.length = 0;
    expect(await auditCheck({ root: "/r", ci: true, args: [] }, run)).toBe(false);
    expect(error).toHaveBeenCalled();
    expect(lines.join("\n")).toContain('{"error":"rate limited"}\nHTTP 200');
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
});
