import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pmProcess } from "../ci/e2e/pm";
import type { Finding } from "../plugins/pmanager/skills/pmanager/scripts/findings";
import { exists } from "./adapters/claude-code";
import { installContract } from "./contract";
import { type AttemptRecord, readAttempts, readManifest } from "./experiment";
import { cleanupFixture } from "./fixture";
import { hashFixture } from "./hashes";
import { scenarioByName } from "./scenarios/registry";
import type { Condition } from "./scenarios/types";
import { PM_TODAY } from "./skill-paths";

export interface RecheckRow {
  attemptId: string;
  condition: Condition;
  /** the epic the attempt added; null when it left none */
  epic: string | null;
  findings: Finding[];
  /** why pm check gave no findings to read */
  problem?: string;
}

export interface RecheckResult {
  rows: RecheckRow[];
  warnings: string[];
}

async function epicDirs(pmDir: string): Promise<string[]> {
  const names = await readdir(pmDir).catch(() => [] as string[]);
  const out: string[] = [];
  for (const name of names) if (await exists(join(pmDir, name, "epic.md"))) out.push(name);
  return out.sort();
}

/**
 * Puts an attempt's saved docs/pm over the fixture's. The fixture keeps its own repo map, which
 * points at this run's temp repos, and its own profiles, which this checkout's pm wrote.
 */
export async function overlay(saved: string, pmDir: string): Promise<void> {
  for (const name of await readdir(saved)) {
    if (name === ".local") continue;
    if (name !== "projects") {
      await rm(join(pmDir, name), { recursive: true, force: true });
      await cp(join(saved, name), join(pmDir, name), { recursive: true });
      continue;
    }
    for (const file of await readdir(join(saved, name))) {
      const to = join(pmDir, name, file);
      if (!(await exists(to))) await cp(join(saved, name, file), to, { recursive: true });
    }
  }
}

async function checkEpic(
  fixtureDir: string,
  slug: string,
): Promise<{ findings: Finding[]; problem?: string }> {
  const r = await pmProcess(fixtureDir, ["check", "--epic", slug, "--json"], { env: { PM_TODAY } });
  try {
    return { findings: (JSON.parse(r.stdout) as { findings: Finding[] }).findings };
  } catch {
    const why = (r.stderr || r.stdout).trim().split("\n")[0] ?? "";
    return { findings: [], problem: `pm check exited ${r.code}: ${why}` };
  }
}

async function recheckScenario(
  dir: string,
  name: string,
  expectedHash: string,
  attempts: AttemptRecord[],
): Promise<RecheckResult> {
  const scenario = scenarioByName(name);
  if (!scenario) throw new Error(`manifest names unknown scenario ${name}`);
  const fixtureDir = await mkdtemp(join(tmpdir(), `pm-bench-recheck-${name}-`));
  let originBare: string | null = null;
  const rows: RecheckRow[] = [];
  const warnings: string[] = [];
  try {
    const built = await scenario.buildFixture(fixtureDir);
    originBare = built.originBare;
    await installContract(fixtureDir);
    const hash = await hashFixture(fixtureDir);
    if (hash !== expectedHash) {
      warnings.push(
        `${name}: the fixture is ${hash}, not the ${expectedHash} the attempts ran on; a finding can come from that change rather than the plan`,
      );
    }
    // One fixture for every attempt: the current pm's profiles, whatever arm the attempt ran in.
    if (scenario.prepareCondition) await scenario.prepareCondition(fixtureDir, "with-skill", built);
    const pmDir = join(fixtureDir, "docs", "pm");
    const pristine = `${fixtureDir}-pm-pristine`;
    await cp(pmDir, pristine, { recursive: true });
    const before = new Set(await epicDirs(pmDir));
    for (const att of attempts) {
      const saved = join(dir, att.artifactsDir, "docs-pm");
      const base = { attemptId: att.attemptId, condition: att.condition };
      if (!(await exists(saved))) {
        rows.push({ ...base, epic: null, findings: [], problem: "the attempt saved no docs/pm" });
        continue;
      }
      const added = (await epicDirs(saved)).filter((e) => !before.has(e));
      if (added.length === 0) rows.push({ ...base, epic: null, findings: [] });
      if (added.length > 0) {
        await overlay(saved, pmDir);
        for (const epic of added)
          rows.push({ ...base, epic, ...(await checkEpic(fixtureDir, epic)) });
        await rm(pmDir, { recursive: true, force: true });
        await cp(pristine, pmDir, { recursive: true });
      }
    }
  } finally {
    await cleanupFixture(fixtureDir);
    if (originBare) await rm(originBare, { recursive: true, force: true });
  }
  return { rows, warnings };
}

/**
 * Replays the plans an experiment's completed attempts left through this checkout's `pm check`,
 * offline: a rule change can be judged on saved plans before a paid run.
 */
export async function recheckExperiment(dir: string): Promise<RecheckResult> {
  const m = await readManifest(dir);
  const done = (await readAttempts(dir)).filter((a) => a.status === "completed");
  const order = new Map(m.planned.map((p, i) => [p.attemptId, i]));
  done.sort((x, y) => (order.get(x.attemptId) ?? 0) - (order.get(y.attemptId) ?? 0));
  const out: RecheckResult = { rows: [], warnings: [] };
  for (const entry of m.scenarios) {
    const mine = done.filter((a) => a.scenario === entry.name);
    if (mine.length === 0) continue;
    const r = await recheckScenario(dir, entry.name, entry.fixtureHash, mine);
    out.rows.push(...r.rows);
    out.warnings.push(...r.warnings);
  }
  return out;
}

function ruleCounts(findings: Finding[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, n]) => (n > 1 ? `${rule} x${n}` : rule))
    .join(", ");
}

export function formatRecheck(id: string, conditions: Condition[], r: RecheckResult): string {
  const attempts = [...new Set(r.rows.map((x) => x.attemptId))];
  const lines = [`recheck ${id}: ${attempts.length} completed attempt(s)`];
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  for (const row of r.rows) {
    const head = `${row.attemptId} (${row.condition})`;
    if (row.problem) lines.push(`${head}${row.epic ? ` ${row.epic}` : ""}: ${row.problem}`);
    else if (!row.epic) lines.push(`${head}: no new epic`);
    else
      lines.push(
        `${head} ${row.epic}: ${row.findings.length ? ruleCounts(row.findings) : "clean"}`,
      );
  }
  const perCondition = new Map(conditions.map((c) => [c, new Set<string>()]));
  const withRule = new Map<string, Map<Condition, Set<string>>>();
  for (const row of r.rows) {
    perCondition.get(row.condition)?.add(row.attemptId);
    for (const f of row.findings) {
      const byCond = withRule.get(f.rule) ?? new Map<Condition, Set<string>>();
      const set = byCond.get(row.condition) ?? new Set<string>();
      set.add(row.attemptId);
      byCond.set(row.condition, set);
      withRule.set(f.rule, byCond);
    }
  }
  if (withRule.size > 0) {
    lines.push("attempts with each rule:");
    const width = Math.max(...[...withRule.keys()].map((k) => k.length));
    for (const rule of [...withRule.keys()].sort()) {
      const cells = conditions.map(
        (c) => `${c} ${withRule.get(rule)?.get(c)?.size ?? 0} of ${perCondition.get(c)?.size ?? 0}`,
      );
      lines.push(`  ${rule.padEnd(width)}  ${cells.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
