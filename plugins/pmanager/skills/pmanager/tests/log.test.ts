import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatLogEntry,
  logFileName,
  parseLogEntry,
  randomLogId,
  writeLogEntry,
} from "../scripts/log";
import { makeTempDir } from "./helpers";

describe("log entries", () => {
  const entry = {
    date: "2026-09-15",
    epic: "argocd-compute-class",
    harness: "claude-code",
    kind: "claim" as const,
    message: "claimed by claude-code",
  };
  test("file name and format", () => {
    expect(logFileName(entry, "ab12cd")).toBe("2026-09-15-argocd-compute-class-ab12cd.md");
    expect(formatLogEntry(entry)).toBe(
      "---\ndate: 2026-09-15\nepic: argocd-compute-class\nharness: claude-code\nkind: claim\n---\nclaimed by claude-code\n",
    );
  });
  test("randomLogId is 6 lowercase hex chars", () => {
    expect(randomLogId()).toMatch(/^[0-9a-f]{6}$/);
  });
  test("write then parse round-trips", async () => {
    const pmDir = await makeTempDir("pm");
    const path = await writeLogEntry(pmDir, entry, "ab12cd");
    expect(path).toBe(join(pmDir, "log", "2026-09-15-argocd-compute-class-ab12cd.md"));
    const parsed = parseLogEntry(path, await readFile(path, "utf8"));
    expect(parsed).toEqual({ path, ...entry });
  });
});
