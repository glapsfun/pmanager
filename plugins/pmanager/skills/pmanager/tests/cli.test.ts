import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  copyFixture,
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
    const parsed = JSON.parse(r.stdout) as { remote: string; rows: Array<{ slug: string }> };
    expect(parsed.remote).toBe("none");
    expect(parsed.rows[0]?.slug).toBe("app-performance");
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
    expect(await readFile(join(a, "docs/pm/INDEX.md"), "utf8")).toContain(
      "test-harness · 2026-09-15",
    );
    expect((await run(["check"], a)).code).toBe(0);
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
    expect(await gitOk(["log", "-1", "--format=%s"], a)).toContain("render after claim");
    const j = await run(["release", "app-performance", "--json"], a);
    const parsed = JSON.parse(j.stdout) as { ok: boolean; renderPush: { ok: boolean } };
    expect(parsed.ok).toBe(true);
    expect(parsed.renderPush.ok).toBe(false);
    expect(j.code).toBe(1);
  });
});
