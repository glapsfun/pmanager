import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { daysBetween } from "../../ci/e2e/dates";
import { pmProcess } from "../../ci/e2e/pm";
import { playStory, STORY_END } from "../../ci/e2e/story";
import { buildBaseAt, gitDateEnv, sh } from "../../ci/e2e/workspace";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { type FixtureInfo, headSha, lsRemoteRefs } from "../fixture";
import { PM_TODAY } from "../skill-paths";
import { multiRepoContext, withoutProfiles } from "./multi-repo-context";
import type { Scenario } from "./types";

/**
 * pm names each log file with a random id, and the memo's changelog orders a
 * day's lines by file name, so two builds of the story differ only there.
 * Ids taken from the content make every build, and so the manifest's fixture
 * hash, the same.
 */
async function stableLogIds(manager: string): Promise<void> {
  const dir = join(manager, "docs", "pm", "log");
  const taken = new Set<string>();
  for (const name of (await readdir(dir)).sort()) {
    const m = /^(.+)-([0-9a-f]{6})\.md$/.exec(name);
    if (!m) continue;
    const text = await readFile(join(dir, name), "utf8");
    let id = "";
    for (let n = 0; id === "" || taken.has(`${m[1]}-${id}`); n++) {
      id = createHash("sha256").update(`${text}\0${n}`).digest("hex").slice(0, 6);
    }
    taken.add(`${m[1]}-${id}`);
    if (id !== m[2]) {
      await sh(["git", "mv", `docs/pm/log/${name}`, `docs/pm/log/${m[1]}-${id}.md`], manager);
    }
  }
}

/**
 * The example workspace as the story leaves it: the finished healthcheck
 * epic, the staging epic in flight, both claims, the three projects and the
 * memo the planner kept, which names every target's checks and the release
 * order. The follow-up to multi-repo-context-cold: does that memo close the
 * cross-repo-order gap?
 */
export function buildMultiRepoContextAsIsFixture(dir: string): Promise<FixtureInfo> {
  return withoutProfiles(() => asIsFixture(dir));
}

async function asIsFixture(dir: string): Promise<FixtureInfo> {
  const shiftDays = daysBetween(STORY_END, PM_TODAY);
  const ws = await buildBaseAt(dir, { shiftDays });
  await playStory(ws, { shiftDays });
  await stableLogIds(dir);
  const render = await pmProcess(dir, ["render"], { env: { PM_TODAY } });
  if (render.code !== 0) throw new Error(`pm render failed: ${render.stderr}`);
  await sh(["git", "add", "docs/pm"], dir);
  await sh(
    ["git", "commit", "-q", "-m", "docs(pm): stable log file names"],
    dir,
    gitDateEnv(PM_TODAY),
  );
  await sh(["git", "push", "-q", "origin", "main"], dir);
  return {
    baselineSha: await headSha(dir),
    originBare: ws.remote,
    originRefs: await lsRemoteRefs(dir, "origin"),
    epicSlugsBefore: (await loadPmRepo(dir)).epics.map((e) => e.slug),
    initialDirty: {},
  };
}

export const multiRepoContextAsIs: Scenario = {
  ...multiRepoContext,
  name: "multi-repo-context-asis",
  buildFixture: buildMultiRepoContextAsIsFixture,
};
