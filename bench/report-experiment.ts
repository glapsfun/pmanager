import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aggregate, type ExperimentSummary, type GroupStats, type Quartiles } from "./aggregate";
import { type Manifest, readAttempts, readManifest } from "./experiment";

const DASH = "—";

export function pct(n: number | null): string {
  return n === null ? DASH : `${Math.round(n * 100)}%`;
}

export function signedPct(n: number | null): string {
  if (n === null) return DASH;
  const v = Math.round(n * 100);
  return `${v < 0 ? "-" : "+"}${Math.abs(v)}%`;
}

function fixed(n: number, signed = false): string {
  const s = Math.abs(n).toFixed(2);
  return signed ? `${n < 0 ? "-" : "+"}${s}` : s;
}

export function iqr(q: Quartiles | null, signed = false): string {
  return q ? `${fixed(q.median, signed)} (${fixed(q.q1, signed)}–${fixed(q.q3, signed)})` : DASH;
}

function secs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function money(n: number | null): string {
  return n === null ? DASH : `$${n.toFixed(2)}`;
}

function failedCell(g: GroupStats): string {
  const parts = (Object.keys(g.failed) as (keyof GroupStats["failed"])[])
    .filter((k) => k !== "completed" && g.failed[k] > 0)
    .map((k) => `${k} ${g.failed[k]}`);
  return parts.length ? parts.join(", ") : DASH;
}

function tokensCell(g: GroupStats): string {
  const i = g.tokens.input;
  const o = g.tokens.output;
  return i && o ? `${Math.round(i.median)}/${Math.round(o.median)} (${i.n})` : DASH;
}

function costCell(g: GroupStats): string {
  return g.cost.sumUsd === null ? DASH : `${money(g.cost.sumUsd)} (${g.cost.n})`;
}

function headline(m: Manifest): string {
  const conditions = `${m.conditions.length} condition${m.conditions.length === 1 ? "" : "s"}`;
  const model = `model ${m.modelRequested}${m.reasoning ? ` (${m.reasoning})` : ""}`;
  const repo = `repo ${m.repoSha} (${m.repoDirty ? "dirty" : "clean"})`;
  return `${m.harness} ${m.harnessVersion} · ${model} · ${conditions} · ${m.pairs} pairs · timeout ${m.timeoutS}s · skill ${m.skillVersion} (${m.skillHash}) · ${repo} · isolation ${m.isolation ?? "none"}`;
}

function groupRow(g: GroupStats): string {
  const cells = [
    g.scenario,
    g.condition,
    g.planned,
    g.attempted,
    g.completed,
    failedCell(g),
    pct(g.successRate),
    iqr(g.score),
    g.durationMs ? secs(g.durationMs.median) : DASH,
    tokensCell(g),
    costCell(g),
  ];
  return `| ${cells.join(" | ")} |`;
}

export function renderExperimentReport(m: Manifest, s: ExperimentSummary): string {
  const out: string[] = [`# Experiment ${m.id}`, "", headline(m), ""];
  if (s.preliminary) out.push("**Preliminary**: fewer than 10 completed pairs.", "");
  if (s.noCostTelemetry) out.push("**No cost telemetry** for this harness.", "");
  out.push(
    "## Per scenario and condition",
    "",
    "| Scenario | Condition | Planned | Attempted | Completed | Failed | Success rate | Score median (IQR) | Duration median | Tokens in/out (n) | Cost (n) |",
    "| :--- | :--- | ---: | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: |",
    ...s.groups.map(groupRow),
    "",
  );
  const first = s.pairings[0];
  if (first) {
    out.push(
      `## Paired differences (${first.a} minus ${first.b})`,
      "",
      "| Scenario | Pairs completed | Pairs excluded | Score diff median (IQR) | Success diff |",
      "| :--- | ---: | ---: | ---: | ---: |",
      ...s.pairings.map(
        (p) =>
          `| ${p.scenario} | ${p.pairsCompleted} | ${p.pairsExcluded} | ${iqr(p.scoreDiff, true)} | ${signedPct(p.successDiff)} |`,
      ),
      "",
    );
  }
  const checkIds = [...new Set(s.groups.flatMap((g) => Object.keys(g.checkFailureRate)))];
  if (checkIds.length) {
    const rate = (g: GroupStats, id: string) =>
      id in g.checkFailureRate ? pct(g.checkFailureRate[id] as number) : DASH;
    out.push(
      "## Check failure rates over completed attempts",
      "",
      `| Scenario | Condition | ${checkIds.join(" | ")} |`,
      `| :--- | :--- | ${checkIds.map(() => "---:").join(" | ")} |`,
      ...s.groups
        .filter((g) => g.completed > 0)
        .map(
          (g) =>
            `| ${g.scenario} | ${g.condition} | ${checkIds.map((id) => rate(g, id)).join(" | ")} |`,
        ),
      "",
    );
  }
  const attempted = s.groups.reduce((n, g) => n + g.attempted, 0);
  const withCost = s.groups.reduce((n, g) => n + g.cost.n, 0);
  out.push(
    `Spend: ${money(s.spendUsd)} across ${withCost} attempts with cost telemetry; ${attempted} attempts total.`,
    "",
  );
  return out.join("\n");
}

export interface ExperimentItem {
  m: Manifest;
  s: ExperimentSummary;
}

/** The compact table shared by BENCH.md and the README region. */
export function renderExperimentsSection(items: ExperimentItem[]): string[] {
  if (items.length === 0) return [];
  const rows = items.flatMap(({ m, s }) => {
    const label = `${m.id}${s.preliminary ? " (preliminary)" : ""}`;
    return m.scenarios.map((sc) => {
      const group = (c: string | undefined) =>
        c ? s.groups.find((g) => g.scenario === sc.name && g.condition === c) : undefined;
      const a = group(m.conditions[0]);
      const b = group(m.conditions[1]);
      const p = s.pairings.find((x) => x.scenario === sc.name);
      const pairs = p ? `${p.pairsCompleted} (${p.pairsExcluded})` : `${a?.completed ?? 0}`;
      const success = b
        ? `${pct(a?.successRate ?? null)} / ${pct(b.successRate)}`
        : pct(a?.successRate ?? null);
      const diff = p?.scoreDiff ? fixed(p.scoreDiff.median, true) : DASH;
      const fresh = (g: GroupStats | undefined) =>
        g?.tokens.fresh ? String(Math.round(g.tokens.fresh.median)) : DASH;
      const tokens = b ? `${fresh(a)} / ${fresh(b)}` : fresh(a);
      const model = `${m.modelRequested}${m.reasoning ? ` (${m.reasoning})` : ""}`;
      return `| ${label} | ${m.harness} ${m.harnessVersion} | ${model} | ${sc.name} | ${pairs} | ${success} | ${diff} | ${tokens} | ${money(s.spendUsd)} |`;
    });
  });
  return [
    "## Experiments",
    "",
    "| Experiment | Harness | Model | Scenario | Pairs (excluded) | Success with / without | Score diff median | Fresh tokens with / without | Cost |",
    "| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
  ];
}

export async function loadExperiments(experimentsDir: string): Promise<ExperimentItem[]> {
  let names: string[];
  try {
    names = (await readdir(experimentsDir)).sort();
  } catch {
    return [];
  }
  const out: ExperimentItem[] = [];
  for (const name of names) {
    const dir = join(experimentsDir, name);
    try {
      await stat(join(dir, "manifest.json"));
    } catch {
      continue;
    }
    const m = await readManifest(dir);
    out.push({ m, s: aggregate(m, await readAttempts(dir)) });
  }
  return out;
}

export async function writeExperimentReport(dir: string): Promise<void> {
  const m = await readManifest(dir);
  const s = aggregate(m, await readAttempts(dir));
  await writeFile(join(dir, "REPORT.md"), renderExperimentReport(m, s));
}
