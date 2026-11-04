import { beforeAll, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

describe("mid-flight epic", () => {
  let ws: Workspace;
  const pm = (cwd: string, ...args: string[]) =>
    pmProcess(cwd, args, { env: { PM_TODAY: STORY_END } });
  const SLUG = "staging-environment";

  beforeAll(async () => {
    ws = await buildWorkspace(await makeTempDir("multi-repo-midflight"));
  }, 120_000);

  test("worktree beside the targets; handoff resolves targets from main and the worktree", async () => {
    expect(await exists(ws.worktree(SLUG))).toBe(true);
    expect(dirname(ws.worktree(SLUG))).toBe(dirname(ws.repos.infra));
    for (const cwd of [ws.manager, ws.worktree(SLUG)]) {
      const h = await pm(cwd, "handoff", SLUG, "T04");
      expect(h.code).toBe(0);
      expect(h.stdout).toContain(`- ${TARGETS.infra} → ${ws.repos.infra}`);
      expect(h.stdout).toContain(`- ${TARGETS.argocd} → ${ws.repos.argocd}`);
    }
  });

  test("verify attaches the tagged infra commit to T01's repo-prefixed criterion", async () => {
    const v = await pm(ws.manager, "verify", SLUG, "T01");
    expect(v.code).toBe(0);
    const criterion = v.stdout
      .split("\n- [")
      .find((c) => c.includes("`infra/envs/staging/main.tf` exists"));
    expect(criterion).toContain("[infra:envs/staging/main.tf] present");
    expect(v.stdout).not.toContain("infra/envs/staging/main.tf] missing");
  });

  test("History records a failed attempt and its fix", async () => {
    const t02 = await readFile(
      join(ws.worktree(SLUG), "docs/pm", SLUG, "tasks/T02-apply-staging-capture-access.md"),
      "utf8",
    );
    const history = (t02.split("## History")[1] ?? "").trim().split("\n");
    expect(history[0]).toContain("status todo -> in-progress");
    expect(history[1]).toContain("attempt failed: tried CI apply");
    expect(history[2]).toContain("status in-progress -> done; fixed by quota raise");
    const check = await pm(ws.manager, "check", "--epic", SLUG);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("OK");
  });

  test("status shows progress, the worktree, a blocker and a live claim", async () => {
    const s = await pm(ws.manager, "status");
    const row = s.stdout.split("\n").findIndex((l) => l.startsWith(`${SLUG} `));
    const block = s.stdout
      .split("\n")
      .slice(row, row + 6)
      .join("\n");
    expect(block).toMatch(new RegExp(`^${SLUG}\\s+feature\\s+in-progress`));
    expect(block).toContain(`worktree: ${ws.worktree(SLUG)}`);
    expect(block).toContain("session: claude-code");
    expect(block).not.toContain("[stale]");
    expect(block).toContain("T07");
  });
});
