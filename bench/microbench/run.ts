import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../../plugins/pmanager/skills/pmanager/scripts/check";
import { prune } from "../../plugins/pmanager/skills/pmanager/scripts/prune";
import { applyRender } from "../../plugins/pmanager/skills/pmanager/scripts/render";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import {
  buildResearch,
  formatResearch,
} from "../../plugins/pmanager/skills/pmanager/scripts/research";
import { buildStatus, formatStatus } from "../../plugins/pmanager/skills/pmanager/scripts/status";
import { RESEARCH_FIXTURES } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/research-fixtures";
import { CHECK_OPTS } from "../graders/context";
import type { ResearchSize, Timing, ToolBenchLine } from "../history";
import { generatePmRepo } from "./generate";

export interface MicrobenchOptions {
  epics: number;
  tasks: number;
  iterations: number;
}

export interface MicrobenchResult {
  epics: number;
  tasks: number;
  iterations: number;
  statusMs: Timing;
  checkMs: Timing;
  renderMs: Timing;
  research: ResearchSize[];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function timing(values: number[]): Timing {
  return { median: Math.round(median(values)), max: Math.round(Math.max(0, ...values)) };
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

/** pm research output size on each research fixture, unpruned and at the default budget */
export async function researchSizes(): Promise<ResearchSize[]> {
  const out: ResearchSize[] = [];
  for (const f of RESEARCH_FIXTURES) {
    const dir = await mkdtemp(join(tmpdir(), `pm-microbench-${f.name}-`));
    try {
      await f.build(dir);
      const r = await buildResearch({
        root: dir,
        cwd: dir,
        keywords: f.keywords,
        paths: [],
        limit: 20,
        gh: false,
      });
      out.push({
        fixture: f.name,
        fullBytes: Buffer.byteLength(formatResearch({ ...r, pruned: null })),
        prunedBytes: Buffer.byteLength(formatResearch(prune(r))),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return out;
}

export async function runMicrobench(opts: MicrobenchOptions): Promise<MicrobenchResult> {
  const root = await mkdtemp(join(tmpdir(), "pm-microbench-"));
  try {
    await generatePmRepo(root, { epics: opts.epics, tasks: opts.tasks });
    const status: number[] = [];
    const checks: number[] = [];
    const renders: number[] = [];
    for (let i = 0; i < opts.iterations; i++) {
      status.push(
        await timed(async () =>
          formatStatus(buildStatus(await loadPmRepo(root), null, "none", CHECK_OPTS)),
        ),
      );
      checks.push(await timed(async () => check(await loadPmRepo(root), CHECK_OPTS)));
      renders.push(await timed(async () => applyRender(await loadPmRepo(root))));
    }
    return {
      epics: opts.epics,
      tasks: opts.epics * opts.tasks,
      iterations: opts.iterations,
      statusMs: timing(status),
      checkMs: timing(checks),
      renderMs: timing(renders),
      research: await researchSizes(),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function toToolLine(
  r: MicrobenchResult,
  meta: { sha: string; skillVersion: string },
): ToolBenchLine {
  return {
    kind: "tool",
    date: new Date().toISOString(),
    sha: meta.sha,
    skillVersion: meta.skillVersion,
    epics: r.epics,
    tasks: r.tasks,
    iterations: r.iterations,
    statusMs: r.statusMs,
    checkMs: r.checkMs,
    renderMs: r.renderMs,
    research: r.research,
  };
}
