import { readFile, writeFile } from "node:fs/promises";
import { replaceBetweenMarkers } from "../plugins/pmanager/skills/pmanager/scripts/render";
import { type AgentRunLine, type HistoryLine, readHistory, type ToolBenchLine } from "./history";

export const README_START = "<!-- bench:start -->";
export const README_END = "<!-- bench:end -->";

const DASH = "—";

function day(iso: string): string {
  return iso.slice(0, 10);
}

function secs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function signed(n: number, suffix = ""): string {
  return `${n < 0 ? "-" : "+"}${Math.abs(n)}${suffix}`;
}

function score(n: number): string {
  return n.toFixed(2);
}

function scoreDelta(cur: number, prev: number | undefined): string {
  if (prev === undefined) return DASH;
  const d = cur - prev;
  return `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(2)}`;
}

function tokensInOut(l: AgentRunLine): string {
  const t = l.telemetry.tokens;
  return t ? `${t.input}/${t.output}` : DASH;
}

function cacheRw(l: AgentRunLine): string {
  const t = l.telemetry.tokens;
  return t ? `${t.cacheRead}/${t.cacheWrite}` : DASH;
}

function tokensDelta(cur: AgentRunLine, prev: AgentRunLine | undefined): string {
  const a = cur.telemetry.tokens;
  const b = prev?.telemetry.tokens;
  if (!a || !b) return DASH;
  return signed(a.input + a.output - (b.input + b.output));
}

function cost(l: AgentRunLine): string {
  return l.telemetry.costUsd === null ? DASH : `$${l.telemetry.costUsd.toFixed(2)}`;
}

function turns(l: AgentRunLine): string {
  return l.telemetry.turns === null ? DASH : String(l.telemetry.turns);
}

function toolCalls(l: AgentRunLine): string {
  const c = l.telemetry.toolCalls;
  if (!c) return DASH;
  const parts = Object.entries(c)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(", ") : DASH;
}

function failed(l: AgentRunLine): string {
  return l.failed.length ? l.failed.join(", ") : DASH;
}

function seriesKey(l: AgentRunLine): string {
  return `${l.harness}|${l.model ?? ""}|${l.scenario}`;
}

function byDateAsc(a: HistoryLine, b: HistoryLine): number {
  return a.date.localeCompare(b.date);
}

interface Series {
  cur: AgentRunLine;
  prev: AgentRunLine | undefined;
}

function latestPerSeries(agents: AgentRunLine[]): Series[] {
  const groups = new Map<string, AgentRunLine[]>();
  for (const l of [...agents].sort(byDateAsc)) {
    const k = seriesKey(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, runs]) => ({
      cur: runs[runs.length - 1] as AgentRunLine,
      prev: runs[runs.length - 2],
    }));
}

function renderLatest(agents: AgentRunLine[]): string[] {
  if (agents.length === 0) return ["_no agent runs recorded_", ""];
  const rows = latestPerSeries(agents).map(({ cur, prev }) =>
    [
      `${cur.harness} ${cur.harnessVersion}`,
      cur.model ?? DASH,
      cur.scenario,
      score(cur.score),
      scoreDelta(cur.score, prev?.score),
      failed(cur),
      secs(cur.durationMs),
      prev ? signed(Math.round((cur.durationMs - prev.durationMs) / 1000), "s") : DASH,
      tokensInOut(cur),
      cacheRw(cur),
      tokensDelta(cur, prev),
      cost(cur),
      turns(cur),
      toolCalls(cur),
      day(cur.date),
      cur.sha,
    ].join(" | "),
  );
  return [
    "| Harness | Model | Scenario | Score | Δ score | Failed | Duration | Δ duration | Tokens in/out | Cache r/w | Δ tokens | Cost | Turns | Tool calls | Date | Sha |",
    "| :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- | :--- |",
    ...rows.map((r) => `| ${r} |`),
    "",
  ];
}

function timing(t: { median: number; max: number }): string {
  return `${t.median}/${t.max} ms`;
}

function timingDelta(cur: { median: number }, prev: { median: number } | undefined): string {
  return prev ? signed(cur.median - prev.median, " ms") : DASH;
}

function renderTool(tools: ToolBenchLine[]): string[] {
  if (tools.length === 0) return ["_no tool microbench recorded_", ""];
  const sorted = [...tools].sort(byDateAsc);
  const cur = sorted[sorted.length - 1] as ToolBenchLine;
  const prev = sorted[sorted.length - 2];
  const row = [
    cur.epics,
    cur.tasks,
    cur.iterations,
    timing(cur.statusMs),
    timingDelta(cur.statusMs, prev?.statusMs),
    timing(cur.checkMs),
    timingDelta(cur.checkMs, prev?.checkMs),
    timing(cur.renderMs),
    timingDelta(cur.renderMs, prev?.renderMs),
    day(cur.date),
    cur.sha,
  ].join(" | ");
  return [
    "| Epics | Tasks | Iterations | status median/max | Δ | check median/max | Δ | render median/max | Δ | Date | Sha |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |",
    `| ${row} |`,
    "",
  ];
}

function renderHistory(agents: AgentRunLine[]): string[] {
  if (agents.length === 0) return ["_no agent runs recorded_", ""];
  const rows = [...agents]
    .sort((a, b) => b.date.localeCompare(a.date) || a.harness.localeCompare(b.harness))
    .slice(0, 20)
    .map((l) =>
      [
        day(l.date),
        l.sha,
        l.harness,
        l.model ?? DASH,
        l.scenario,
        l.run,
        score(l.score),
        failed(l),
        secs(l.durationMs),
        tokensInOut(l),
        cost(l),
      ].join(" | "),
    );
  return [
    "| Date | Sha | Harness | Model | Scenario | Run | Score | Failed | Duration | Tokens in/out | Cost |",
    "| :--- | :--- | :--- | :--- | :--- | ---: | ---: | :--- | ---: | ---: | ---: |",
    ...rows.map((r) => `| ${r} |`),
    "",
  ];
}

export function renderReport(lines: HistoryLine[]): string {
  const { agents, tools } = split(lines);
  const out = [
    "# PManager benchmark",
    "",
    "Rendered by `bun run bench/bench.ts report` from `bench/results/history.jsonl`. Numbers are comparable only within one harness and model.",
    "",
    "## Latest agent runs",
    "",
    ...renderLatest(agents),
    "## Tool microbench",
    "",
    ...renderTool(tools),
    "## History (last 20 agent runs)",
    "",
    ...renderHistory(agents),
  ];
  return out.join("\n");
}

function freshTokens(l: AgentRunLine): string {
  const t = l.telemetry.tokens;
  return t ? String(t.input + t.cacheWrite) : DASH;
}

function split(lines: HistoryLine[]): { agents: AgentRunLine[]; tools: ToolBenchLine[] } {
  return {
    agents: lines.filter((l): l is AgentRunLine => l.kind === "agent"),
    tools: lines.filter((l): l is ToolBenchLine => l.kind === "tool"),
  };
}

/** The compact block embedded in the root README between the bench markers. */
export function renderReadmeSection(lines: HistoryLine[]): string {
  const { agents, tools } = split(lines);
  const body: string[] = [];
  if (agents.length === 0) {
    body.push("_no benchmark runs recorded_");
  } else {
    body.push(
      "| Harness | Model | Scenario | Score | Duration | Fresh tokens | Cost |",
      "| :--- | :--- | :--- | ---: | ---: | ---: | ---: |",
      ...latestPerSeries(agents).map(
        ({ cur }) =>
          `| ${cur.harness} ${cur.harnessVersion} | ${cur.model ?? DASH} | ${cur.scenario} | ${score(cur.score)} | ${secs(cur.durationMs)} | ${freshTokens(cur)} | ${cost(cur)} |`,
      ),
    );
  }
  const latestTool = [...tools].sort(byDateAsc).pop();
  if (latestTool) {
    body.push(
      "",
      `Tool microbench: status ${latestTool.statusMs.median} ms, check ${latestTool.checkMs.median} ms, render ${latestTool.renderMs.median} ms (median on ${latestTool.epics} epics, ${latestTool.tasks} tasks).`,
    );
  }
  const last = [...lines].sort(byDateAsc).pop();
  if (last) body.push("", `_Last run: ${day(last.date)} at ${last.sha}._`);
  return [README_START, ...body, README_END, ""].join("\n");
}

export async function writeReadmeSection(
  readmePath: string,
  lines: HistoryLine[],
): Promise<boolean> {
  const before = await readFile(readmePath, "utf8");
  const after = replaceBetweenMarkers(before, README_START, README_END, renderReadmeSection(lines));
  if (after === null) return false;
  if (after !== before) await writeFile(readmePath, after);
  return true;
}

export async function writeReport(
  historyPath: string,
  reportPath: string,
  readmePath?: string,
): Promise<void> {
  const lines = await readHistory(historyPath);
  await writeFile(reportPath, renderReport(lines));
  if (readmePath) await writeReadmeSection(readmePath, lines);
}

export async function readReport(reportPath: string): Promise<string> {
  return readFile(reportPath, "utf8");
}
