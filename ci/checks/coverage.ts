import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Check } from "../gate";
import { PACKAGES, type PackageName } from "../packages";
import { capture } from "../proc";

export interface Totals {
  lines: number;
  functions: number;
}

const FLOOR_FILE = join(import.meta.dir, "..", "coverage-floor.json");

const pct = (hit: number, found: number): number => (found === 0 ? 100 : (hit / found) * 100);

/** Package-wide line and function percent from lcov, ignoring tests and files outside pkgDir. */
export function lcovTotals(lcov: string, pkgDir: string): Totals {
  let lf = 0;
  let lh = 0;
  let fnf = 0;
  let fnh = 0;
  for (const record of lcov.split("end_of_record")) {
    const sf = /^SF:(.*)$/m.exec(record)?.[1]?.trim();
    if (!sf) continue;
    const rel = relative(pkgDir, isAbsolute(sf) ? sf : resolve(pkgDir, sf));
    if (rel === ".." || rel.startsWith("../") || rel.startsWith("tests/")) continue;
    const num = (key: string): number =>
      Number(new RegExp(`^${key}:(\\d+)`, "m").exec(record)?.[1] ?? 0);
    lf += num("LF");
    lh += num("LH");
    fnf += num("FNF");
    fnh += num("FNH");
  }
  return { lines: pct(lh, lf), functions: pct(fnh, fnf) };
}

/** Messages for each measured value that is below its floor, or a missing floor. */
export function coverageProblems(pkg: PackageName, t: Totals, floor: Totals | undefined): string[] {
  if (!floor) {
    return [
      `coverage: no floor for ${pkg} (measured lines ${t.lines.toFixed(2)}% functions ${t.functions.toFixed(2)}%)`,
    ];
  }
  const out: string[] = [];
  if (t.lines < floor.lines) {
    out.push(`coverage: ${pkg} lines ${t.lines.toFixed(2)}% below floor ${floor.lines}%`);
  }
  if (t.functions < floor.functions) {
    out.push(
      `coverage: ${pkg} functions ${t.functions.toFixed(2)}% below floor ${floor.functions}%`,
    );
  }
  return out;
}

/** Runs each package's unit tests with coverage and enforces the per-package floor. */
export const testCheck: Check = async (ctx) => {
  const floors = JSON.parse(readFileSync(FLOOR_FILE, "utf8")) as Partial<
    Record<PackageName, Totals>
  >;
  let ok = true;
  for (const p of PACKAGES) {
    const cwd = join(ctx.root, p.dir);
    const tmp = mkdtempSync(join(tmpdir(), `cov-${p.name}-`));
    try {
      const run = await capture(
        [
          "bun",
          "test",
          "./tests",
          "--coverage",
          "--coverage-reporter=text",
          "--coverage-reporter=lcov",
          `--coverage-dir=${tmp}`,
        ],
        cwd,
      );
      process.stdout.write(run.stdout);
      process.stderr.write(run.stderr);
      if (run.code !== 0) {
        ok = false;
        continue;
      }
      const totals = lcovTotals(readFileSync(join(tmp, "lcov.info"), "utf8"), cwd);
      const floor = floors[p.name];
      const f = floor ? `${floor.lines}/${floor.functions}` : "none";
      console.log(
        `coverage ${p.name}: lines ${totals.lines.toFixed(2)}% functions ${totals.functions.toFixed(2)}% (floor ${f})`,
      );
      for (const problem of coverageProblems(p.name, totals, floor)) {
        console.error(problem);
        ok = false;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return ok;
};
