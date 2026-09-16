import { adapterByName, HARNESS_NAMES } from "./adapters/registry";
import { type ParsedArgs, parseArgs } from "./cli-args";
import { appendHistory } from "./history";
import { runMicrobench, toToolLine } from "./microbench/run";
import { writeReport } from "./report";
import { repoSha, runScenario } from "./runner";
import { SCENARIOS, scenarioByName } from "./scenarios/registry";
import { HISTORY_PATH, RAW_DIR, README_PATH, REPORT_PATH, readSkillVersion } from "./skill-paths";

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

const USAGE = `usage:
  bun run bench/bench.ts run --harness <${HARNESS_NAMES.join("|")}> [--model <id>] [--scenario <name>]... [--runs N] [--timeout-s N] [--keep]
  bun run bench/bench.ts tool [--epics N] [--tasks N] [--iterations N]
  bun run bench/bench.ts report
common: [--history <path>] [--report <path>] [--raw-dir <dir>]
scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}
`;

/** The root README is refreshed only from the committed history, never from overridden paths. */
function readmeFor(a: ParsedArgs): string | undefined {
  return a.historyPath === undefined && a.reportPath === undefined ? README_PATH : undefined;
}

async function cmdRun(a: ParsedArgs, io: Io): Promise<number> {
  const adapter = a.harness ? adapterByName(a.harness) : undefined;
  if (!adapter) {
    io.err(`run needs --harness, one of: ${HARNESS_NAMES.join(", ")}\n`);
    return 2;
  }
  const d = await adapter.detect();
  if (!d.available) {
    io.err(`${adapter.name} unavailable: ${d.reason ?? "unknown"}\n`);
    return 1;
  }
  const names = a.scenarios.length ? a.scenarios : SCENARIOS.map((s) => s.name);
  const scenarios = names.map((n) => scenarioByName(n));
  const missing = names.filter((_, i) => !scenarios[i]);
  if (missing.length) {
    io.err(`unknown scenario(s): ${missing.join(", ")}\n`);
    return 2;
  }
  const meta = {
    sha: await repoSha(),
    skillVersion: await readSkillVersion(),
    harnessVersion: d.version ?? "unknown",
  };
  const historyPath = a.historyPath ?? HISTORY_PATH;
  for (const scenario of scenarios) {
    if (!scenario) continue;
    for (let run = 1; run <= a.runs; run++) {
      io.out(`▶ ${adapter.name} ${scenario.name} run ${run}/${a.runs}\n`);
      const r = await runScenario({
        adapter,
        scenario,
        model: a.model,
        timeoutMs: a.timeoutS * 1000,
        keep: a.keep,
        run,
        historyPath,
        rawDir: a.rawDir ?? RAW_DIR,
        meta,
      });
      const failed = r.line.failed.length ? ` failed: ${r.line.failed.join(", ")}` : "";
      const secs = Math.round(r.line.durationMs / 1000);
      const timedOut = r.line.timedOut ? " (timed out)" : "";
      io.out(`  score ${r.line.score.toFixed(2)} in ${secs}s${timedOut}${failed}\n`);
      if (a.keep) io.out(`  fixture kept at ${r.fixtureDir}\n`);
      io.out(`  raw log ${r.rawLogPath}\n`);
    }
  }
  await writeReport(historyPath, a.reportPath ?? REPORT_PATH, readmeFor(a));
  return 0;
}

async function cmdTool(a: ParsedArgs, io: Io): Promise<number> {
  const r = await runMicrobench({ epics: a.epics, tasks: a.tasks, iterations: a.iterations });
  const line = toToolLine(r, { sha: await repoSha(), skillVersion: await readSkillVersion() });
  const historyPath = a.historyPath ?? HISTORY_PATH;
  await appendHistory(historyPath, line);
  await writeReport(historyPath, a.reportPath ?? REPORT_PATH, readmeFor(a));
  io.out(`epics ${r.epics}, tasks ${r.tasks}, iterations ${r.iterations}\n`);
  io.out(
    `status ${r.statusMs.median}/${r.statusMs.max} ms  check ${r.checkMs.median}/${r.checkMs.max} ms  render ${r.renderMs.median}/${r.renderMs.max} ms (median/max)\n`,
  );
  return 0;
}

export async function main(argv: string[], io: Io): Promise<number> {
  let a: ParsedArgs;
  try {
    a = parseArgs(argv);
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  switch (a.command) {
    case "run":
      return cmdRun(a, io);
    case "tool":
      return cmdTool(a, io);
    case "report":
      await writeReport(a.historyPath ?? HISTORY_PATH, a.reportPath ?? REPORT_PATH, readmeFor(a));
      io.out(`wrote ${a.reportPath ?? REPORT_PATH}\n`);
      return 0;
    default:
      io.err(USAGE);
      return 2;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
  process.exit(code);
}
