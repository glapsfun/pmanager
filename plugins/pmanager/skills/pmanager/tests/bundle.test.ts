import { describe, expect, test } from "bun:test";
import { parseBundle } from "../scripts/bundle";

const B = (...parts: string[]) => parts.join("\n");
const M = (p: string) => `<!-- pm:file ${p} -->`;

const basic = B(M("s/plan.md"), "", "# Plan", "", M("s/tasks/T01-a.md"), "task", "");
const basicFiles = [
  { path: "s/plan.md", content: "# Plan\n" },
  { path: "s/tasks/T01-a.md", content: "task\n" },
];

describe("parseBundle", () => {
  test("splits sections and trims blank edges", () => {
    expect(parseBundle(basic, "s")).toEqual({ ok: true, files: basicFiles });
  });

  test("memo path is allowed", () => {
    const r = parseBundle(B(M("pmanager-memo.md"), "memo"), "s");
    expect(r).toEqual({ ok: true, files: [{ path: "pmanager-memo.md", content: "memo\n" }] });
  });

  test("trailing spaces after a marker are allowed", () => {
    const r = parseBundle(B(`${M("s/plan.md")}   `, "x"), "s");
    expect(r.ok).toBe(true);
  });

  test("CRLF parses like LF", () => {
    expect(parseBundle(basic.split("\n").join("\r\n"), "s")).toEqual({
      ok: true,
      files: basicFiles,
    });
  });

  test("a marker inside a fenced block is content", () => {
    const r = parseBundle(B(M("s/plan.md"), "```md", M("s/x.md"), "```", "after"), "s");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.content).toContain(M("s/x.md"));
  });

  test("a marker inside a tilde fence is content", () => {
    const r = parseBundle(B(M("s/plan.md"), "~~~", M("s/x.md"), "~~~", "after"), "s");
    expect(r.ok && r.files.length).toBe(1);
  });

  const refusals: [string, string, string][] = [
    ["absolute path", B(M("/abs/x.md"), "x"), "/abs/x.md"],
    ["dot-dot segment", B(M("s/../t/plan.md"), "x"), "s/../t/plan.md"],
    ["dot segment", B(M("s/./plan.md"), "x"), "s/./plan.md"],
    ["log path", B(M("log/2026-09-15-s-abc123.md"), "x"), "log/2026-09-15-s-abc123.md"],
    ["index", B(M("INDEX.md"), "x"), "INDEX.md"],
    ["local dir", B(M(".local/repos.json"), "x"), ".local/repos.json"],
    ["other epic", B(M("other/plan.md"), "x"), "other/plan.md"],
    ["non-md file", B(M("s/notes.txt"), "x"), "s/notes.txt"],
    ["duplicate path", B(M("s/plan.md"), "a", M("s/plan.md"), "b"), "s/plan.md"],
    ["empty section", B(M("s/plan.md"), "", M("s/b.md"), "b"), "s/plan.md"],
    ["text before first marker", B("hello", M("s/plan.md"), "x"), "before"],
    ["no markers", "just text\n", "empty bundle"],
  ];
  test.each(refusals)("refuses %s", (_name, text, needle) => {
    const r = parseBundle(text, "s");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(needle);
  });
});
