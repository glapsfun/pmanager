import { check } from "../../plugins/pmanager/skills/pmanager/scripts/check";
import type { Finding } from "../../plugins/pmanager/skills/pmanager/scripts/findings";
import { git, gitOk } from "../../plugins/pmanager/skills/pmanager/scripts/git";
import {
  type EpicRecord,
  loadPmRepo,
  type PmRepo,
} from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import type { Telemetry } from "../adapters/types";
import type { FixtureInfo } from "../fixture";
import { PM_TODAY } from "../skill-paths";
import type { CheckContext } from "./types";

export const CHECK_OPTS = { staleDays: 14, today: PM_TODAY };

function porcelainPaths(out: string): string[] {
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const p = l.slice(3).trim();
      const arrow = p.indexOf(" -> ");
      return arrow === -1 ? p : p.slice(arrow + 4);
    });
}

export async function changedPathsSince(
  dir: string,
  baseline: string,
  ignore: string[],
): Promise<{ paths: string[]; dirty: boolean }> {
  const committed = (await gitOk(["diff", "--name-only", baseline, "HEAD"], dir))
    .split("\n")
    .filter((l) => l.trim() !== "");
  const uncommitted = porcelainPaths(
    await gitOk(["status", "--porcelain", "--untracked-files=all"], dir),
  );
  const keep = (p: string) => !ignore.includes(p);
  const paths = [...new Set([...committed, ...uncommitted])].filter(keep).sort();
  return { paths, dirty: uncommitted.filter(keep).length > 0 };
}

export async function newCommitsSince(dir: string, baseline: string): Promise<number> {
  const r = await git(["rev-list", "--count", `${baseline}..HEAD`], dir);
  return r.code === 0 ? Number.parseInt(r.stdout.trim(), 10) || 0 : 0;
}

export async function buildCheckContext(
  fixtureDir: string,
  info: FixtureInfo,
  telemetry: Telemetry,
): Promise<CheckContext> {
  let repo: PmRepo | null = null;
  let findings: Finding[] = [];
  try {
    repo = await loadPmRepo(fixtureDir);
    findings = check(repo, CHECK_OPTS);
  } catch {
    repo = null;
  }
  const { paths, dirty } = await changedPathsSince(fixtureDir, info.baselineSha, info.ignorePaths);
  return {
    fixtureDir,
    baselineSha: info.baselineSha,
    originBare: info.originBare,
    originRefs: info.originRefs,
    epicSlugsBefore: info.epicSlugsBefore,
    repo,
    findings,
    changedPaths: paths,
    newCommits: await newCommitsSince(fixtureDir, info.baselineSha),
    dirty,
    telemetry,
  };
}

export function newEpics(ctx: CheckContext): EpicRecord[] {
  return (ctx.repo?.epics ?? []).filter((e) => !ctx.epicSlugsBefore.includes(e.slug));
}

export function errorsOf(ctx: CheckContext): Finding[] {
  return ctx.findings.filter((f) => f.severity === "error");
}
