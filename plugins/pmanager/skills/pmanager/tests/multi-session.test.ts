import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { gitOk } from "../scripts/git";
import { worktreePath } from "../scripts/worktree";
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
    const plain = await makeTempDir("ms-plain");
    await initGitRepo(plain);
    const none = await pm(plain, "pi", ...CSV);
    expect(none.code).toBe(2);
    expect(none.stdout).toContain("no origin remote");
  });

  test("release --abandon through the CLI", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await pm(a, "claude-code", ...CSV)).code).toBe(0);
    const r = await pm(a, "claude-code", "release", "csv-export", "--abandon");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("csv-export abandoned");
  });
});
