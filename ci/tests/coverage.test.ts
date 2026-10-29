import { expect, test } from "bun:test";
import { coverageProblems, lcovTotals } from "../checks/coverage";

function rec(sf: string, lf: number, lh: number, fnf = 0, fnh = 0): string {
  return `SF:${sf}\nFNF:${fnf}\nFNH:${fnh}\nLF:${lf}\nLH:${lh}\nend_of_record\n`;
}

test("lcovTotals weights by lines and functions, skips tests and outside files", () => {
  const lcov =
    rec("scripts/a.ts", 10, 9, 4, 4) +
    rec("scripts/b.ts", 30, 27, 6, 5) +
    rec("tests/helpers.ts", 10, 1) +
    rec("../plugins/x.ts", 10, 0);
  expect(lcovTotals(lcov, "/abs/pkg")).toEqual({ lines: 90, functions: 90 });
});

test("absolute SF paths inside the package count", () => {
  const lcov = rec("/abs/pkg/scripts/a.ts", 10, 5, 2, 1) + rec("/abs/other/x.ts", 10, 0, 1, 0);
  expect(lcovTotals(lcov, "/abs/pkg")).toEqual({ lines: 50, functions: 50 });
});

test("coverageProblems", () => {
  const floor = { lines: 97, functions: 99 };
  const low = coverageProblems("tool", { lines: 96.4, functions: 99 }, floor);
  expect(low).toHaveLength(1);
  expect(low[0]).toContain("tool lines 96.40% below floor 97%");
  expect(coverageProblems("tool", { lines: 97, functions: 99 }, floor)).toEqual([]);
  const none = coverageProblems("tool", { lines: 96.4, functions: 99 }, undefined);
  expect(none).toHaveLength(1);
  expect(none[0]).toContain("no floor for tool");
  expect(none[0]).toContain("96.40");
});
