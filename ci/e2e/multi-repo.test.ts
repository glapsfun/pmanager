import { beforeAll, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { pmProcess } from "./pm";
import { STORY_END } from "./story";
import { buildBase, buildWorkspace, TARGETS, type TargetName, type Workspace } from "./workspace";

const NAMES = Object.keys(TARGETS) as TargetName[];

const commitCount = async (dir: string) =>
  Number((await gitOk(["rev-list", "--count", "HEAD"], dir)).trim());

describe("base workspace", () => {
  test("four repos, one commit each, targets mapped", async () => {
    const dir = await makeTempDir("multi-repo");
    const ws = await buildBase(dir);
    expect(await commitCount(ws.manager)).toBe(1);
    expect((await gitOk(["remote", "get-url", "origin"], ws.manager)).trim()).toBe(
      join(dir, "remotes", "manager.git"),
    );
    for (const name of NAMES) {
      expect(await commitCount(ws.repos[name])).toBe(1);
      expect((await gitOk(["remote", "get-url", "origin"], ws.repos[name])).trim()).toBe(
        TARGETS[name],
      );
    }
    const map = JSON.parse(
      await readFile(join(ws.manager, "docs/pm/.local/repos.json"), "utf8"),
    ) as Record<string, string>;
    expect(map).toEqual({
      [TARGETS.webshop]: ws.repos.webshop,
      [TARGETS.infra]: ws.repos.infra,
      [TARGETS.argocd]: ws.repos.argocd,
    });
    const status = await pmProcess(ws.manager, ["status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("remote: ok");
    expect(status.stdout).toContain("no epics under docs/pm");
  });

  test("building twice into the same directory starts clean", async () => {
    const dir = await makeTempDir("multi-repo");
    const first = await buildBase(dir);
    await writeFile(join(first.repos.infra, "stray.txt"), "left over\n");
    const second = await buildBase(dir);
    expect(await commitCount(second.repos.infra)).toBe(1);
    expect(await exists(join(second.repos.infra, "stray.txt"))).toBe(false);
  });
});

describe("story", () => {
  let ws: Workspace;
  const pm = (cwd: string, ...args: string[]) =>
    pmProcess(cwd, args, { env: { PM_TODAY: STORY_END } });

  beforeAll(async () => {
    ws = await buildWorkspace(await makeTempDir("multi-repo-story"));
  }, 120_000);

  test("finished epic is merged on main and verifiable in two repos", async () => {
    const status = await pm(ws.manager, "status");
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/webshop-healthcheck\s+feature\s+done/);
    expect(status.stdout).not.toMatch(/webshop-healthcheck[^\n]*\n\s*session:/);
    expect(await exists(join(ws.manager, "docs/pm/pmanager-memo.md"))).toBe(true);
    const t02 = await pm(ws.manager, "verify", "webshop-healthcheck", "T02");
    expect(t02.code).toBe(0);
    const firstCriterion = t02.stdout.split("\n- [")[1] ?? "";
    expect(firstCriterion).toMatch(
      /\[argocd:git log\] [0-9a-f]+ \S+ [^\n]*webshop-healthcheck T02/,
    );
    expect(t02.stdout).not.toContain("gaps:");
    const t01 = await pm(ws.manager, "verify", "webshop-healthcheck", "T01");
    expect(t01.stdout).toContain("[webshop:git log]");
    expect(await gitOk(["branch", "-r"], ws.manager)).not.toContain("pm/webshop-healthcheck");
  });
});
