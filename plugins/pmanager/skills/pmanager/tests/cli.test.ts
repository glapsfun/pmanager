import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreeFor, worktreePath } from "../scripts/worktree";
import {
  copyFixture,
  exists,
  gitOk,
  initGitRepo,
  installPreReceiveHook,
  makeTempDir,
  remoteWithClones,
  unclaimedSeed,
} from "./helpers";

const PM = join(import.meta.dir, "..", "scripts", "pm.ts");

async function run(args: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", PM, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PM_TODAY: "2026-09-15", PM_HARNESS: "test-harness", ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function localRepo() {
  const root = await makeTempDir("cli");
  await copyFixture(root);
  await initGitRepo(root);
  await gitOk(["add", "-A"], root);
  await gitOk(["commit", "-q", "-m", "seed"], root);
  return root;
}

describe("environment", () => {
  test("no command → usage, exit 2", async () => {
    const r = await run([], await localRepo());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage");
  });
  test("not a git repo → exit 2", async () => {
    const r = await run(["check"], await makeTempDir("nogit"));
    expect(r.code).toBe(2);
  });
  test("no docs/pm → exit 2", async () => {
    const dir = await makeTempDir("nopm");
    await initGitRepo(dir);
    const r = await run(["check"], dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no docs/pm");
  });
});

describe("check", () => {
  test("clean fixture exits 0", async () => {
    const r = await run(["check"], await localRepo());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("OK");
  });
  test("error exits 1 and --json is parseable; nothing written", async () => {
    const root = await localRepo();
    const p = join(root, "docs/pm/app-performance/tasks/T04-restore-pagination.md");
    await Bun.write(p, (await readFile(p, "utf8")).replace("status: todo", "status: done"));
    const r = await run(["check", "--json"], root);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      errors: number;
      findings: Array<{ rule: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toBeGreaterThan(0);
    expect(parsed.findings.map((f) => f.rule)).toContain("E-RND-001");
    const after = await readFile(join(root, "docs/pm/INDEX.md"), "utf8");
    expect(after).toContain("| 0/4 |");
  });
});

describe("render", () => {
  test("rewrites stale views, then check passes", async () => {
    const root = await localRepo();
    const p = join(root, "docs/pm/app-performance/tasks/T01-benchmark-orders.md");
    await Bun.write(p, (await readFile(p, "utf8")).replace("status: todo", "status: in-progress"));
    const r = await run(["render", "--json"], root);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { written: string[] };
    expect(parsed.written.length).toBe(1);
    expect((await run(["check"], root)).code).toBe(0);
  });
});

describe("status and handoff", () => {
  test("status without remote", async () => {
    const r = await run(["status", "--json"], await localRepo());
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      remote: string;
      rows: Array<{ slug: string; type: string; primaryMetric: string }>;
      memo: { path: string; context: string } | null;
    };
    expect(parsed.remote).toBe("none");
    expect(parsed.rows[0]?.slug).toBe("app-performance");
    expect(parsed.rows[0]?.type).toBe("bug");
    expect(parsed.rows[0]?.primaryMetric).toBe("p95 /orders < 500ms");
    expect(parsed.memo?.path).toBe("docs/pm/pmanager-memo.md");
    expect(parsed.memo?.context).toContain("## 4. Conventions & constraints");
    expect(parsed.memo?.context).not.toContain("pm:log:start");
  });
  test("status text ends with the memo block", async () => {
    const r = await run(["status"], await localRepo());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("\nmemo: docs/pm/pmanager-memo.md\n# PManager memo\n");
    expect(r.stdout.trimEnd().endsWith("All schema changes need DBA review.")).toBe(true);
  });
  test("handoff prints the brief; unknown task exits 2", async () => {
    const root = await localRepo();
    const ok = await run(["handoff", "app-performance", "T01"], root);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("# Handoff — Fix orders page latency / T01");
    const bad = await run(["handoff", "app-performance", "T99"], root);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("unknown task T99");
  });
});

describe("claim through the CLI", () => {
  test("claim renders the session into INDEX and second claim exits 1", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const first = await run(["claim", "app-performance"], a);
    expect(first.code).toBe(0);
    const wt = worktreePath(a, "app-performance");
    expect(await readFile(join(wt, "docs/pm/INDEX.md"), "utf8")).toContain(
      "test-harness · 2026-09-15",
    );
    expect((await run(["check", "--epic", "app-performance"], a)).code).toBe(0);
    const second = await run(["claim", "app-performance", "--harness", "pi"], b);
    expect(second.code).toBe(1);
    expect(second.stdout).toContain("owned by test-harness");
    const status = await run(["status", "--json"], b);
    const parsed = JSON.parse(status.stdout) as {
      remote: string;
      rows: Array<{ remoteClaim: boolean; session: { harness: string } | null }>;
    };
    expect(parsed.remote).toBe("ok");
    expect(parsed.rows[0]?.remoteClaim).toBe(true);
    expect(parsed.rows[0]?.session?.harness).toBe("test-harness");
    const rel = await run(["release", "app-performance"], a);
    expect(rel.code).toBe(0);
  });

  test("status in another clone lists an epic that exists only on a claim branch", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const epic = (await readFile(join(a, "docs/pm/app-performance/epic.md"), "utf8")).replaceAll(
      "app-performance",
      "brand-new",
    );
    await Bun.write(join(a, "docs/pm/brand-new/epic.md"), epic);
    expect((await run(["claim", "brand-new"], a)).code).toBe(0);
    const status = await run(["status", "--json"], b);
    const parsed = JSON.parse(status.stdout) as {
      rows: Array<{ slug: string; remoteOnly: boolean; session: { harness: string } | null }>;
    };
    const row = parsed.rows.find((r) => r.slug === "brand-new");
    expect(row?.remoteOnly).toBe(true);
    expect(row?.session?.harness).toBe("test-harness");
  });

  test("a failed render push after a successful claim exits 1 and names the retry", async () => {
    const { bare, a } = await remoteWithClones(await unclaimedSeed());
    // Reject only the follow-up render commit; the claim push itself succeeds.
    await installPreReceiveHook(
      bare,
      'while read old new ref; do msg=$(git log -1 --format=%s "$new"); case "$msg" in *"render after"*) echo "no render pushes" >&2; exit 1;; esac; done; exit 0',
    );
    const r = await run(["claim", "app-performance"], a);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("claimed by test-harness");
    expect(r.stdout).toContain("push failed");
    expect(r.stdout).toContain("retry with: git push origin pm/app-performance");
    expect(await gitOk(["log", "-1", "--format=%s"], worktreePath(a, "app-performance"))).toContain(
      "render after claim",
    );
    const j = await run(["release", "app-performance", "--json"], a);
    const parsed = JSON.parse(j.stdout) as { ok: boolean; renderPush: { ok: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.renderPush.ok).toBe(false);
    expect(j.code).toBe(1);
  });

  test("release by a different harness exits 1 unless --force", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await run(["claim", "app-performance"], a)).code).toBe(0);
    await gitOk(["fetch", "-q", "origin"], b);
    await gitOk(["checkout", "-q", "-b", "pm/app-performance", "origin/pm/app-performance"], b);
    const refused = await run(["release", "app-performance", "--harness", "pi"], b);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("owned by test-harness");
    const forced = await run(["release", "app-performance", "--harness", "pi", "--force"], b);
    expect(forced.code).toBe(0);
    const status = await run(["status", "--json"], a);
    const parsed = JSON.parse(status.stdout) as { rows: Array<{ session: unknown }> };
    expect(parsed.rows[0]?.session).toBeNull();
  });
});

describe("verify", () => {
  test("prints the per-criterion report, exit 0", async () => {
    const root = await localRepo();
    const r = await run(["verify", "app-performance", "T02"], root);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")[0]).toMatch(
      /^verify: app-performance T02 · repos: \. · since 2026-09-01 \(root, epic created\) · \d+ms$/,
    );
    expect(r.stdout).toContain("- [ ] Migration file exists and applies cleanly");
    expect(r.stdout).toContain(
      "gaps: git@github.com:glapsfun/webshop.git not checked out on this machine",
    );
    expect(r.stdout).toContain("gaps: no mapped repos; inspected the orchestration repo");
  });
  test("--json mirrors the report", async () => {
    const root = await localRepo();
    const r = await run(
      ["verify", "app-performance", "T02", "--json", "--files", "app/app.py"],
      root,
    );
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.slug).toBe("app-performance");
    expect(j.task).toBe("T02");
    expect(j.criteria).toHaveLength(2);
    expect(Object.keys(j.scope).sort()).toEqual([
      "commits",
      "files",
      "testsTouched",
      "uncommitted",
    ]);
    expect(j.repos[0].since.reason).toBe("epic created");
  });
  test("--since REF is honoured; an unresolvable ref is exit 2", async () => {
    const root = await localRepo();
    const r = await run(["verify", "app-performance", "T02", "--since", "HEAD", "--json"], root);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).repos[0].since.reason).toBe("--since");
    const bad = await run(["verify", "app-performance", "T02", "--since", "nope"], root);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("--since nope");
  });
  test("exit 2 on unknown epic, unknown task, missing args, bad --limit, unknown --repo, non-git --repo path", async () => {
    const root = await localRepo();
    const noEpic = await run(["verify", "nope", "T02"], root);
    expect(noEpic.code).toBe(2);
    expect(noEpic.stderr).toContain("unknown epic nope");
    const noTask = await run(["verify", "app-performance", "T99"], root);
    expect(noTask.code).toBe(2);
    expect(noTask.stderr).toContain("unknown task T99 in app-performance");
    expect((await run(["verify", "app-performance"], root)).code).toBe(2);
    expect((await run(["verify", "app-performance", "T02", "--limit", "0"], root)).code).toBe(2);
    const unknown = await run(["verify", "app-performance", "T02", "--repo", "nope"], root);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("known names in docs/pm/.local/repos.json");
    const plain = await makeTempDir("plain");
    const notGit = await run(["verify", "app-performance", "T02", "--repo", plain], root);
    expect(notGit.code).toBe(2);
    expect(notGit.stderr).toContain("not inside a git repository");
  });
  test("usage lists verify", async () => {
    const r = await run([], await localRepo());
    expect(r.stderr).toContain("verify <slug> <task-id>");
    expect(r.stderr).toContain("--since REF");
    expect(r.stderr).toContain("--files P");
  });
});

describe("worktrees", () => {
  test("claim prints the worktree path and leaves the checkout on main", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const r = await run(["claim", "app-performance"], a);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`worktree: ${worktreePath(a, "app-performance")}`);
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], a)).trim()).toBe("main");
  });
  test("claim --json carries the worktree field", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const r = await run(["claim", "app-performance", "--json"], a);
    expect(JSON.parse(r.stdout).worktree).toBe(worktreePath(a, "app-performance"));
  });
  test("render --epic writes in the worktree, not the checkout", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const r = await run(["render", "--epic", "app-performance"], a);
    expect(r.code).toBe(0);
    const wtIndex = join(worktreePath(a, "app-performance"), "docs", "pm", "INDEX.md");
    expect(await readFile(wtIndex, "utf8")).toContain("app-performance");
  });
  test("check --epic reads the worktree", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    expect((await run(["check", "--epic", "app-performance"], a)).code).toBe(0);
  });
  test("status shows the worktree path for a claimed epic", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const r = await run(["status"], a);
    expect(r.stdout).toContain(`worktree: ${worktreePath(a, "app-performance")}`);
  });
  test("release removes the worktree", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const gone = await run(["release", "app-performance"], a);
    expect(gone.code).toBe(0);
    expect(gone.stdout).toContain("worktree removed:");
    expect(await exists(worktreePath(a, "app-performance"))).toBe(false);
    expect(await worktreeFor(a, "pm/app-performance")).toBeNull();
  });
  test("release --keep-worktree leaves it in place", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const kept = await run(["release", "app-performance", "--keep-worktree"], a);
    expect(kept.code).toBe(0);
    expect(kept.stdout).not.toContain("worktree removed:");
    expect(await exists(worktreePath(a, "app-performance"))).toBe(true);
  });
  test("release keeps a dirty worktree and says why", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const wt = worktreePath(a, "app-performance");
    await Bun.write(join(wt, "scratch.md"), "unsaved\n");
    const r = await run(["release", "app-performance"], a);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("scratch.md");
    expect(r.stdout).toContain("--keep-worktree");
    expect(await exists(wt)).toBe(true);
  });
  test("--no-worktree switches the checkout like before", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const r = await run(["claim", "app-performance", "--no-worktree"], a);
    expect(r.code).toBe(0);
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], a)).trim()).toBe(
      "pm/app-performance",
    );
    expect(await worktreeFor(a, "pm/app-performance")).not.toBeNull();
  });
  test("handoff and verify read tasks written in the worktree after the claim", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const wt = worktreePath(a, "app-performance");
    const t01 = await readFile(
      join(wt, "docs/pm/app-performance/tasks/T01-benchmark-orders.md"),
      "utf8",
    );
    await Bun.write(
      join(wt, "docs/pm/app-performance/tasks/T09-new-task.md"),
      t01
        .replace("id: T01", "id: T09")
        .replace("title: Benchmark orders endpoint", "title: Added after the claim"),
    );
    const h = await run(["handoff", "app-performance", "T09"], a);
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("Added after the claim");
    const v = await run(["verify", "app-performance", "T09", "--json"], a);
    expect(v.code).toBe(0);
    expect(JSON.parse(v.stdout).task).toBe("T09");
  });

  test("status counts tasks from the worktree, not the caller's copy", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await run(["claim", "app-performance"], a);
    const wt = worktreePath(a, "app-performance");
    const t01Path = join(wt, "docs/pm/app-performance/tasks/T01-benchmark-orders.md");
    const t01 = await readFile(t01Path, "utf8");
    await Bun.write(t01Path, t01.replace("status: todo", "status: done"));
    const r = await run(["status", "--json"], a);
    const row = JSON.parse(r.stdout).rows.find(
      (x: { slug: string }) => x.slug === "app-performance",
    );
    expect(row.done).toBe(1);
    expect(row.next?.id).not.toBe("T01");
  });

  test("usage documents the new flags", async () => {
    const r = await run([], await localRepo());
    expect(r.stderr).toContain("--no-worktree");
    expect(r.stderr).toContain("--keep-worktree");
    expect(r.stderr).toContain("--epic");
  });
});
