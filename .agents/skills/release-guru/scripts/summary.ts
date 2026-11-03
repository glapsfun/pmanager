import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { notesProblems } from "./changes";
import type { Ctx, Result } from "./context";
import { type Evidence, freshEvidence, type ReleaseState, readState, statePaths } from "./state";

const CHECK_LABEL: Record<Evidence["check"], string> = { gate: "gate", agents: "agent e2e" };

function checksTable(s: ReleaseState): string {
  const fresh = freshEvidence(s);
  const rows = (["gate", "agents"] as const).map((c) => {
    const e = fresh[c];
    if (!e) return `| ${c} | not run | | | |`;
    const tools = Object.entries(e.tools)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    return `| ${c} | ${e.result} | ${e.tree.slice(0, 7)} | ${tools} | ${e.finishedAt} |`;
  });
  return [
    "| Check | Result | Tree | Tools | Finished |",
    "| :--- | :--- | :--- | :--- | :--- |",
    ...rows,
  ].join("\n");
}

/** The newest paid run on this tree; a later check that skipped it does not clear its result. */
function lastAgentRun(s: ReleaseState): Evidence | undefined {
  let last: Evidence | undefined;
  for (const e of s.evidence) {
    if (e.check !== "agents" || e.tree !== s.tree || e.result === "skipped") continue;
    if (!last || e.finishedAt > last.finishedAt) last = e;
  }
  return last;
}

/** Blockers a reader must see before saying yes. */
export function summaryBlockers(s: ReleaseState, notes: string): string[] {
  const fresh = freshEvidence(s);
  const out = [...s.blockers, ...notesProblems(notes)];
  if (fresh.gate?.result !== "pass") out.push(`${CHECK_LABEL.gate} has not passed for this tree`);
  const run = lastAgentRun(s);
  if (run && run.result !== "pass") {
    out.push(
      `${CHECK_LABEL.agents} did not pass for this tree: run check --agent-e2e until it passes, or abandon and prepare again`,
    );
  } else if (!run && fresh.agents?.result !== "skipped") {
    out.push(`${CHECK_LABEL.agents} has not passed for this tree`);
  }
  return [...new Set(out)];
}

export function renderSummary(s: ReleaseState, notes: string, dist: string[]): string {
  const fresh = freshEvidence(s);
  const details = (["gate", "agents"] as const)
    .flatMap((c) => {
      const e = fresh[c];
      return e ? [`### ${c}`, "", "```", e.detail, "```", ""] : [];
    })
    .join("\n");
  const blockers = summaryBlockers(s, notes);
  return [
    `# pmanager v${s.version} release candidate`,
    "",
    `Version: ${s.version} (previous: ${s.previousTag ?? "none"})`,
    `Branch: ${s.branch ?? "none"}`,
    `Commit: ${s.commit}`,
    `Tree: ${s.tree}`,
    "",
    "## Notes",
    "",
    notes.trimEnd(),
    "",
    "## Release checks",
    "",
    checksTable(s),
    "",
    details,
    "## Distribution changes",
    "",
    ...dist.map((d) => `- ${d}`),
    "",
    "## Blockers",
    "",
    ...(blockers.length > 0 ? blockers.map((b) => `- ${b}`) : ["- none"]),
    "",
    `To publish: bun run release publish --tree ${s.tree}`,
    "",
  ].join("\n");
}

const VERDICT_LINE =
  /^(\S+ \S+ \d+\/\d+ (PASS|FAIL)|\S+ unavailable|agent e2e: (PASS|FAIL))( \[report-only\])?$/;

/** The agent e2e verdict lines, so report-only and unavailable harnesses stay visible. */
function agentVerdict(s: ReleaseState): string {
  const detail = freshEvidence(s).agents?.detail ?? "";
  const lines = detail.split("\n").filter((l) => VERDICT_LINE.test(l));
  return lines.length > 0
    ? `\nAgent e2e per harness and scenario:\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`
    : "";
}

/** The release PR's body: what users get, then the evidence that it was checked. */
export function prBody(s: ReleaseState, notes: string): string {
  return `${notes.trimEnd()}\n\n## Release checks\n\nCommit ${s.commit}, tree ${s.tree}.\n\n${checksTable(s)}\n${agentVerdict(s)}`;
}

async function distribution(ctx: Ctx, s: ReleaseState): Promise<string[]> {
  if (!s.previousTag) return [`first release: ${s.version}`];
  const prev = s.previousTag.replace(/^v/, "");
  const marketplaceSame = await ctx.git.ok([
    "diff",
    "--quiet",
    s.previousTag,
    s.commit,
    "--",
    ctx.cfg.marketplace,
  ]);
  return [
    `${ctx.cfg.manifests.join(" and ")}: ${prev} to ${s.version}`,
    `${ctx.cfg.marketplace}: ${marketplaceSame ? "unchanged" : "changed"} since ${s.previousTag}`,
  ];
}

export async function cmdSummary(ctx: Ctx): Promise<Result> {
  const s = await readState(ctx.cfg);
  if (!s) return { code: 1, phase: "none", message: "no release in progress", next: "run prepare" };
  const paths = statePaths(ctx.cfg);
  const notes = existsSync(paths.notes) ? await readFile(paths.notes, "utf8") : "";
  const summary = renderSummary(s, notes, await distribution(ctx, s));
  await writeFile(paths.summary, summary);
  const blockers = summaryBlockers(s, notes);
  return {
    code: blockers.length > 0 ? 1 : 0,
    phase: s.phase,
    message: `summary written to ${paths.summary}`,
    next:
      blockers.length > 0
        ? "resolve the blockers first"
        : `show the summary to the maintainer; after their yes run publish --tree ${s.tree}`,
    ...(blockers.length > 0 ? { blockers } : {}),
    data: { summary, tree: s.tree },
  };
}
