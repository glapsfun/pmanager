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

describe("claims", () => {
  const at = (cwd: string, harness: string, ...args: string[]) =>
    pmProcess(cwd, args, { harness, env: { PM_TODAY: STORY_END } });
  const statusBlock = (stdout: string, slug: string) => {
    const lines = stdout.split("\n");
    const row = lines.findIndex((l) => l.startsWith(`${slug} `));
    return row === -1 ? "" : lines.slice(row, row + 6).join("\n");
  };

  test("status flags the stale claim and the abandoned draft", async () => {
    const ws = await buildWorkspace(await makeTempDir("multi-repo-claims"));
    const s = await at(ws.manager, "claude-code", "status");
    const sso = statusBlock(s.stdout, "argocd-sso-dex");
    expect(sso).toContain("codex");
    expect(sso).toContain("[stale]");
    expect(statusBlock(s.stdout, "multi-region-failover")).toMatch(
      /^multi-region-failover\s+initiative\s+abandoned/,
    );
    expect(
      (await gitOk(["ls-remote", "origin", "pm/multi-region-failover"], ws.manager)).trim(),
    ).not.toBe("");
  }, 120_000);

  test("takeover works only on the stale claim, and release frees it", async () => {
    const ws = await buildWorkspace(await makeTempDir("multi-repo-takeover"));
    const take = await at(ws.manager, "claude-code", "claim", "argocd-sso-dex", "--takeover");
    expect(take.code).toBe(0);
    const id = /session: ([0-9a-f]{6})/.exec(take.stdout)?.[1] ?? "";
    expect(id).not.toBe("");
    const refused = await at(ws.manager, "codex", "claim", "staging-environment", "--takeover");
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("is not stale");
    const release = await at(
      ws.manager,
      "claude-code",
      "release",
      "argocd-sso-dex",
      "--session",
      id,
    );
    expect(release.code).toBe(0);
    expect(await exists(ws.worktree("argocd-sso-dex"))).toBe(false);
    const s = await at(ws.manager, "claude-code", "status");
    expect(statusBlock(s.stdout, "argocd-sso-dex")).toContain("session: unowned");
  }, 120_000);

  // Known pm bug: claim treats an existing pm/<slug> branch as owned even when its
  // epic carries no session, so a released draft reads "owned by unknown since unknown".
  test.failing("a released draft can be claimed again", async () => {
    const ws = await buildWorkspace(await makeTempDir("multi-repo-reclaim"));
    const take = await at(ws.manager, "claude-code", "claim", "argocd-sso-dex", "--takeover");
    const id = /session: ([0-9a-f]{6})/.exec(take.stdout)?.[1] ?? "";
    await at(ws.manager, "claude-code", "release", "argocd-sso-dex", "--session", id);
    const claim = await at(ws.manager, "claude-code", "claim", "argocd-sso-dex");
    expect(claim.code).toBe(0);
    expect(claim.stdout).toContain(`worktree: ${ws.worktree("argocd-sso-dex")}`);
  }, 120_000);
});

describe("whole workspace", () => {
  let ws: Workspace;
  const pm = (cwd: string, ...args: string[]) =>
    pmProcess(cwd, args, { env: { PM_TODAY: STORY_END } });

  beforeAll(async () => {
    ws = await buildWorkspace(await makeTempDir("multi-repo-whole"));
  }, 120_000);

  test("research finds code in each target by URL", async () => {
    const webshop = await pm(
      ws.manager,
      "research",
      "healthz",
      "--repo",
      TARGETS.webshop,
      "--no-gh",
    );
    expect(webshop.code).toBe(0);
    expect(webshop.stdout).toContain("[main.go:");
    const infra = await pm(ws.manager, "research", "staging", "--repo", TARGETS.infra, "--no-gh");
    expect(infra.stdout).toContain("[envs/staging/main.tf:");
    expect(
      (await pm(ws.manager, "research", "probe", "--repo", TARGETS.argocd, "--no-gh")).code,
    ).toBe(0);
    const memory = await pm(ws.manager, "research", "health", "--no-gh");
    expect(memory.stdout.split("\nmemory")[1]?.split("\ntests")[0] ?? "").toContain(
      "webshop-healthcheck",
    );
  });

  test("the built workspace is consistent", async () => {
    expect((await pm(ws.manager, "check")).stdout).toContain("OK");
    expect((await pm(ws.manager, "render")).stdout).toContain("nothing to render");
  });

  test("pm never touched a target repo", async () => {
    for (const name of NAMES) {
      const repo = ws.repos[name];
      const authors = new Set((await gitOk(["log", "--format=%an"], repo)).trim().split("\n"));
      expect([...authors].every((a) => a === "pm-example" || a === "implementer")).toBe(true);
      expect((await gitOk(["branch", "--format=%(refname:short)"], repo)).trim()).toBe("main");
      expect((await gitOk(["status", "--porcelain"], repo)).trim()).toBe("");
      expect((await gitOk(["worktree", "list"], repo)).trim().split("\n")).toHaveLength(1);
    }
  });

  test("a workspace path with a space builds and resolves the map", async () => {
    const spaced = await buildWorkspace(join(await makeTempDir("multi repo"), "my ws"));
    const h = await pm(spaced.manager, "handoff", "staging-environment", "T01");
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(new RegExp(`${TARGETS.infra.replaceAll(".", "\\.")} → [^\\n]*my ws`));
  }, 120_000);
});
