import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { notesProblems } from "./changes";
import type { Ctx, Result } from "./context";
import {
  AGENT_RUN_FAILED,
  type Evidence,
  freshEvidence,
  lastAgentRun,
  type ReleaseState,
  readState,
  statePaths,
} from "./state";

const CHECK_LABEL: Record<Evidence["check"], string> = { gate: "gate", agents: "agent e2e" };

/** What the summary and the PR show: a paid run on this tree outranks a later skip. */
function shown(s: ReleaseState): { gate?: Evidence; agents?: Evidence } {
  const fresh = freshEvidence(s);
  return { gate: fresh.gate, agents: lastAgentRun(s) ?? fresh.agents };
}

/** The PR leaves out tools, whose versions name the agent CLIs; the local summary keeps them. */
function checksTable(s: ReleaseState, withTools: boolean): string {
  const ev = shown(s);
  const rows = (["gate", "agents"] as const).map((c) => {
    const e = ev[c];
    if (!e) return withTools ? `| ${c} | not run | | | |` : `| ${c} | not run | | |`;
    const tools = Object.entries(e.tools)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    const cells = [c, e.result, e.tree.slice(0, 7), ...(withTools ? [tools] : []), e.finishedAt];
    return `| ${cells.join(" | ")} |`;
  });
  const head = ["Check", "Result", "Tree", ...(withTools ? ["Tools"] : []), "Finished"];
  return [`| ${head.join(" | ")} |`, `|${" :--- |".repeat(head.length)}`, ...rows].join("\n");
}

/** Blockers a reader must see before saying yes. */
export function summaryBlockers(s: ReleaseState, notes: string): string[] {
  const fresh = freshEvidence(s);
  const out = [...s.blockers, ...notesProblems(notes)];
  if (fresh.gate?.result !== "pass") out.push(`${CHECK_LABEL.gate} has not passed for this tree`);
  const run = lastAgentRun(s);
  if (run && run.result !== "pass") {
    out.push(AGENT_RUN_FAILED);
  } else if (!run && fresh.agents?.result !== "skipped") {
    out.push(`${CHECK_LABEL.agents} has not passed for this tree`);
  }
  return [...new Set(out)];
}

export function renderSummary(s: ReleaseState, notes: string, dist: string[]): string {
  const ev = shown(s);
  const details = (["gate", "agents"] as const)
    .flatMap((c) => {
      const e = ev[c];
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
    checksTable(s, true),
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

/** The release PR's body: what users get, then the evidence that it was checked. */
export function prBody(s: ReleaseState, notes: string): string {
  return `${notes.trimEnd()}\n\n## Release checks\n\nCommit ${s.commit}, tree ${s.tree}.\n\n${checksTable(s, false)}\n`;
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
