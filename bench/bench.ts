import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapterByName, HARNESS_NAMES } from "./adapters/registry";
import { type ParsedArgs, parseArgs } from "./cli-args";
import {
  createExperiment,
  estimateCost,
  readAttempts,
  readManifest,
  remaining,
  repoDirty,
  runExperiment,
  validateManifest,
} from "./experiment";
import { appendHistory, readHistory } from "./history";
import { runMicrobench, toToolLine } from "./microbench/run";
import { writeReport } from "./report";
import { writeExperimentReport } from "./report-experiment";
import { buildEnv, repoSha, runScenario } from "./runner";
import { SCENARIOS, scenarioByName } from "./scenarios/registry";
import { CONDITIONS } from "./scenarios/types";
import {
  EXPERIMENTS_DIR,
  HISTORY_PATH,
  RAW_DIR,
  README_PATH,
  REPORT_PATH,
  readSkillVersion,
} from "./skill-paths";

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

const USAGE = `usage:
  bun run bench/bench.ts run --harness <${HARNESS_NAMES.join("|")}> [--model <id>] [--scenario <name>]... [--runs N] [--timeout-s N] [--keep]
  bun run bench/bench.ts tool [--epics N] [--tasks N] [--iterations N]
  bun run bench/bench.ts report
  bun run bench/bench.ts experiment new --id <id> --harness <name> --model <id> [--reasoning <effort>] [--condition with-skill|without-skill|both] [--pairs N] [--scenario <name>]... [--timeout-s N]
  bun run bench/bench.ts experiment run --id <id> [--yes]      (without --yes: dry run, exit 3)
  bun run bench/bench.ts experiment report --id <id>
common: [--history <path>] [--report <path>] [--raw-dir <dir>] [--experiments-dir <dir>]
scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}
`;

/** The root README is refreshed only from the committed history, never from overridden paths. */
function readmeFor(a: ParsedArgs): string | undefined {
  return a.historyPath === undefined && a.reportPath === undefined ? README_PATH : undefined;
}

function experimentsFor(a: ParsedArgs): string {
  return a.experimentsDir ?? EXPERIMENTS_DIR;
}

async function cmdExperiment(a: ParsedArgs, io: Io): Promise<number> {
  const experimentsDir = experimentsFor(a);
  if (!a.id) {
    io.err("experiment needs --id\n");
    return 2;
  }
  const dir = join(experimentsDir, a.id);
  if (a.sub === "new") {
    const adapter = a.harness ? adapterByName(a.harness) : undefined;
    if (!adapter) {
      io.err(`experiment new needs --harness, one of: ${HARNESS_NAMES.join(", ")}\n`);
      return 2;
    }
    if (!a.model) {
      io.err("experiment new needs --model (recorded and passed explicitly)\n");
      return 2;
    }
    const conditions = a.condition === "both" ? CONDITIONS : [a.condition];
    try {
      const m = await createExperiment(
        {
          id: a.id,
          harness: adapter.name,
          model: a.model,
          reasoning: a.reasoning,
          conditions,
          pairs: a.pairs,
          scenarios: a.scenarios.length ? a.scenarios : SCENARIOS.map((s) => s.name),
          timeoutS: a.timeoutS,
        },
        { adapter, experimentsDir, repoSha, repoDirty },
      );
      io.out(
        `created ${dir}: ${m.planned.length} planned attempt(s), isolation ${m.isolation ?? "none"}\n`,
      );
      return 0;
    } catch (e) {
      io.err(`${(e as Error).message}\n`);
      return 1;
    }
  }
  let manifest: Awaited<ReturnType<typeof readManifest>>;
  try {
    manifest = await readManifest(dir);
  } catch {
    io.err(`no experiment at ${dir}\n`);
    return 1;
  }
  if (a.sub === "report") {
    await writeExperimentReport(dir);
    await writeReport(
      a.historyPath ?? HISTORY_PATH,
      a.reportPath ?? REPORT_PATH,
      readmeFor(a),
      experimentsDir,
    );
    io.out(`wrote ${join(dir, "REPORT.md")}\n`);
    return 0;
  }
  const adapter = adapterByName(manifest.harness);
  if (!adapter) {
    io.err(`unknown harness in manifest: ${manifest.harness}\n`);
    return 1;
  }
  const d = await adapter.detect();
  if (!d.available) {
    io.err(`${adapter.name} unavailable: ${d.reason ?? "unknown"}\n`);
    return 1;
  }
  const problems = await validateManifest(manifest, adapter);
  if (problems.length) {
    const list = problems.join("\n  ");
    io.err(
      `experiment ${manifest.id} inputs changed since it was created:\n  ${list}\nstart a new experiment instead\n`,
    );
    return 1;
  }
  let todo: ReturnType<typeof remaining>;
  try {
    todo = remaining(manifest, await readAttempts(dir));
  } catch (e) {
    io.err(`${(e as Error).message}\n`);
    return 1;
  }
  const est = estimateCost(manifest, await readHistory(a.historyPath ?? HISTORY_PATH), todo.length);
  const shape = `${manifest.scenarios.length} scenario(s) × ${manifest.pairs} pair(s) × ${manifest.conditions.length} condition(s)`;
  const cost = est === null ? "unknown" : `$${est.toFixed(2)}`;
  io.out(
    `experiment ${manifest.id}: ${shape} = ${manifest.planned.length} attempts, ${todo.length} remaining; estimated cost ${cost}\n`,
  );
  if (!a.yes) {
    io.out("dry run; pass --yes to spend\n");
    return 3;
  }
  try {
    const r = await runExperiment(dir, {
      adapter,
      env: buildEnv(adapter),
      home: process.env.HOME ?? "",
      tmp: tmpdir(),
      onAttempt: (rec) => {
        const reason = rec.statusReason ? ` (${rec.statusReason})` : "";
        io.out(`  ${rec.attemptId}: ${rec.status} score ${rec.score.toFixed(2)}${reason}\n`);
      },
    });
    io.out(`ran ${r.ran}, remaining ${r.remaining}\n`);
  } catch (e) {
    io.err(`${(e as Error).message}\n`);
    return 1;
  } finally {
    await writeExperimentReport(dir);
    await writeReport(
      a.historyPath ?? HISTORY_PATH,
      a.reportPath ?? REPORT_PATH,
      readmeFor(a),
      experimentsDir,
    );
  }
  return 0;
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
  await writeReport(historyPath, a.reportPath ?? REPORT_PATH, readmeFor(a), experimentsFor(a));
  return 0;
}

async function cmdTool(a: ParsedArgs, io: Io): Promise<number> {
  const r = await runMicrobench({ epics: a.epics, tasks: a.tasks, iterations: a.iterations });
  const line = toToolLine(r, { sha: await repoSha(), skillVersion: await readSkillVersion() });
  const historyPath = a.historyPath ?? HISTORY_PATH;
  await appendHistory(historyPath, line);
  await writeReport(historyPath, a.reportPath ?? REPORT_PATH, readmeFor(a), experimentsFor(a));
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
    case "experiment":
      return cmdExperiment(a, io);
    case "report":
      await writeReport(
        a.historyPath ?? HISTORY_PATH,
        a.reportPath ?? REPORT_PATH,
        readmeFor(a),
        experimentsFor(a),
      );
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
