import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { gitOk } from "../scripts/git";
import { listWorktrees, worktreePath } from "../scripts/worktree";
import { exists, initGitRepo, makeTempDir, remoteWithClones, unclaimedSeed } from "./helpers";

const PM = join(import.meta.dir, "..", "scripts", "pm.ts");

async function pm(cwd: string, harness: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", "run", PM, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PM_TODAY: "2026-09-28", PM_HARNESS: harness, PM_GH: "/nonexistent" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

const CSV = [
  "claim",
  "csv-export",
  "--draft",
  "--title",
  "CSV export for reports",
  "--type",
  "feature",
];
const SSO = [
  "claim",
  "sso-login",
  "--draft",
  "--title",
  "Single sign-on login",
  "--type",
  "feature",
];

describe("two sessions on one repository", () => {
  test("different features in separate clones both proceed and see each other", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const second = await pm(b, "codex", ...SSO);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("sso-login reserved as draft by codex");
    const status = await pm(b, "codex", "status");
    expect(status.stdout).toContain("csv-export  feature  draft  CSV export for reports");
    expect(status.stdout).toContain("session: claude-code · 2026-09-28 [remote-only]");
  });

  test("same slug one after the other: the second is refused and told the owner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const second = await pm(b, "codex", ...CSV);
    expect(second.code).toBe(1);
    expect(second.stdout).toContain("csv-export is owned by claude-code since 2026-09-28");
  });

  test("same slug at the same moment: exactly one owner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const codes = (await Promise.all([pm(a, "claude-code", ...CSV), pm(b, "codex", ...CSV)])).map(
      (r) => r.code,
    );
    expect(codes.sort()).toEqual([0, 1]);
  });

  test("same feature under another slug is refused as a look-alike until --distinct", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const other = [
      "claim",
      "reports-csv-download",
      "--draft",
      "--title",
      "Download reports as CSV",
      "--type",
      "feature",
    ];
    const refused = await pm(b, "codex", ...other);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("looks like existing work");
    expect(refused.stdout).toContain("csv-export  draft  CSV export for reports");
    expect((await pm(b, "codex", ...other, "--distinct")).code).toBe(0);
    const orders = await pm(
      b,
      "codex",
      "claim",
      "orders-page-slow",
      "--draft",
      "--title",
      "Orders page is slow",
      "--type",
      "bug",
    );
    expect(orders.code).toBe(1);
    expect(orders.stdout).toContain("app-performance");
  });

  test("different features in one checkout: two worktrees, checkout stays on main", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    expect((await pm(a, "codex", ...SSO)).code).toBe(0);
    expect((await gitOk(["branch", "--show-current"], a)).trim()).toBe("main");
    expect(await exists(worktreePath(a, "csv-export"))).toBe(true);
    expect(await exists(worktreePath(a, "sso-login"))).toBe(true);
  });

  test("same slug in one checkout: the second draft is refused and nothing touches the checkout", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const second = await pm(a, "codex", ...CSV);
    expect(second.code).toBe(1);
    expect(await exists(join(a, "docs/pm/csv-export"))).toBe(false);
    expect((await gitOk(["status", "--porcelain"], a)).trim()).toBe("");
  });

  test("usage errors and no remote", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "pi", "claim", "csv-export", "--draft", "--type", "feature")).code).toBe(2);
    expect(
      (await pm(a, "pi", "claim", "csv-export", "--draft", "--title", "X", "--type", "chore")).code,
    ).toBe(2);
    for (const slug of ["Foo Bar", "log"]) {
      const bad = await pm(a, "pi", "claim", slug, "--draft", "--title", "X", "--type", "feature");
      expect(bad.code).toBe(2);
      expect(bad.stderr).toContain("usage");
    }
    expect((await gitOk(["branch", "--list", "pm/*"], a)).trim()).toBe("");
    const plain = await makeTempDir("ms-plain");
    await initGitRepo(plain);
    const none = await pm(plain, "pi", ...CSV);
    expect(none.code).toBe(2);
    expect(none.stdout).toContain("no origin remote");
  });

  test("cold start: follow-up commands work from the checkout after a draft", async () => {
    const { a } = await remoteWithClones({ "README.md": "# app\n" });
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const status = await pm(a, "claude-code", "status");
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("csv-export  feature  draft  CSV export for reports");
    expect((await pm(a, "claude-code", "render", "--epic", "csv-export")).code).toBe(0);
    const check = await pm(a, "claude-code", "check", "--epic", "csv-export");
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("E-STR-002");
    const released = await pm(a, "claude-code", "release", "csv-export", "--abandon");
    expect(released.code).toBe(0);
    expect(released.stdout).toContain("csv-export abandoned");
    const plain = await pm(a, "claude-code", "render");
    expect(plain.code).toBe(2);
    expect(plain.stderr).toContain("no docs/pm directory");
    expect((await pm(a, "claude-code", "check")).code).toBe(2);
  });

  test("release --abandon through the CLI", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const r = await pm(a, "claude-code", "release", "csv-export", "--abandon");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("csv-export abandoned");
  });

  test("release recreates the epic's worktree instead of switching the checkout", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const plain = await pm(a, "claude-code", "release", "csv-export");
    expect(plain.code).toBe(0);
    // the plain release removed the worktree it found; the local branch stays
    expect(await exists(worktreePath(a, "csv-export"))).toBe(false);

    const abandoned = await pm(a, "claude-code", "release", "csv-export", "--abandon");
    expect(abandoned.code).toBe(0);
    expect((await gitOk(["branch", "--show-current"], a)).trim()).toBe("main");
    expect(abandoned.stdout).toContain("worktree removed:");
    expect(await exists(worktreePath(a, "csv-export"))).toBe(false);
    await gitOk(["fetch", "origin"], a);
    expect(await gitOk(["show", "origin/pm/csv-export:docs/pm/csv-export/epic.md"], a)).toContain(
      "status: abandoned",
    );

    const again = await pm(a, "claude-code", "release", "csv-export", "--abandon");
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("already abandoned");
    expect((await gitOk(["branch", "--show-current"], a)).trim()).toBe("main");
    expect(await exists(worktreePath(a, "csv-export"))).toBe(false);
  });

  test("release after origin deletes the branch refuses without building a worktree", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    expect((await pm(a, "claude-code", "release", "csv-export")).code).toBe(0);
    expect(await exists(worktreePath(a, "csv-export"))).toBe(false);
    // a merged PR with branch auto-delete: origin no longer has pm/csv-export
    await gitOk(["push", "-q", "origin", "--delete", "pm/csv-export"], a);

    const r = await pm(a, "claude-code", "release", "csv-export");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("already unclaimed");
    expect(await exists(worktreePath(a, "csv-export"))).toBe(false);
    expect(await listWorktrees(a)).toHaveLength(1);
    expect((await gitOk(["branch", "--show-current"], a)).trim()).toBe("main");
  });

  test("--no-worktree refusals decided by the local record leave the checkout on main", async () => {
    const current = async (dir: string) => (await gitOk(["branch", "--show-current"], dir)).trim();
    const dropOrigin = (dir: string, slug: string) =>
      gitOk(["push", "-q", "origin", "--delete", `pm/${slug}`], dir);

    const unclaimed = (await remoteWithClones(await unclaimedSeed())).a;
    expect((await pm(unclaimed, "claude-code", ...CSV)).code).toBe(0);
    expect((await pm(unclaimed, "claude-code", "release", "csv-export")).code).toBe(0);
    await dropOrigin(unclaimed, "csv-export");
    const r1 = await pm(unclaimed, "claude-code", "release", "csv-export", "--no-worktree");
    expect(r1.code).toBe(1);
    expect(r1.stdout).toContain("already unclaimed");
    expect(await current(unclaimed)).toBe("main");

    const abandoned = (await remoteWithClones(await unclaimedSeed())).a;
    expect((await pm(abandoned, "claude-code", ...CSV)).code).toBe(0);
    expect((await pm(abandoned, "claude-code", "release", "csv-export", "--abandon")).code).toBe(0);
    await dropOrigin(abandoned, "csv-export");
    const r2 = await pm(
      abandoned,
      "claude-code",
      "release",
      "csv-export",
      "--abandon",
      "--no-worktree",
    );
    expect(r2.code).toBe(1);
    expect(r2.stdout).toContain("already abandoned");
    expect(await current(abandoned)).toBe("main");

    const owned = (await remoteWithClones(await unclaimedSeed())).a;
    expect((await pm(owned, "claude-code", ...CSV)).code).toBe(0);
    await gitOk(["worktree", "remove", worktreePath(owned, "csv-export")], owned);
    await dropOrigin(owned, "csv-export");
    const r3 = await pm(owned, "pi", "release", "csv-export", "--no-worktree");
    expect(r3.code).toBe(1);
    expect(r3.stdout).toContain("owned by claude-code");
    expect(await current(owned)).toBe("main");
  });

  test("release from a clone with no local branch refuses no-branch, not the origin record", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", "claim", "app-performance")).code).toBe(0);
    const r = await pm(b, "pi", "release", "app-performance");
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("no local branch");
    expect((await gitOk(["branch", "--show-current"], b)).trim()).toBe("main");
    expect(await listWorktrees(b)).toHaveLength(1);
  });
});
