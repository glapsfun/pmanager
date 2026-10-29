import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  listWorktrees,
  worktreePath,
} from "../../plugins/pmanager/skills/pmanager/scripts/worktree";
import {
  exists,
  gitOk,
  initGitRepo,
  makeTempDir,
  remoteWithClones,
  unclaimedSeed,
} from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { epicBundle, pmProcess } from "./pm";

const pm = (cwd: string, harness: string, ...args: string[]) => pmProcess(cwd, args, { harness });

const sid = (stdout: string) => /session: ([0-9a-f]{6})/.exec(stdout)?.[1] ?? "missing";

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
    expect(status.stdout).toMatch(
      /session: claude-code · 2026-09-28 · [0-9a-f]{6} \[remote-only\]/,
    );
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
    const draft = await pm(a, "claude-code", ...CSV);
    expect(draft.code).toBe(0);
    const id = sid(draft.stdout);
    const status = await pm(a, "claude-code", "status");
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("csv-export  feature  draft  CSV export for reports");
    const rendered = await pm(a, "claude-code", "render", "--epic", "csv-export", "--session", id);
    expect(rendered.code).toBe(0);
    const check = await pm(a, "claude-code", "check", "--epic", "csv-export");
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("E-STR-002");
    const released = await pm(
      a,
      "claude-code",
      "release",
      "csv-export",
      "--abandon",
      "--session",
      id,
    );
    expect(released.code).toBe(0);
    expect(released.stdout).toContain("csv-export abandoned");
    const plain = await pm(a, "claude-code", "render");
    expect(plain.code).toBe(2);
    expect(plain.stderr).toContain("no docs/pm directory");
    expect((await pm(a, "claude-code", "check")).code).toBe(2);
  });

  test("release --abandon through the CLI", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const d = await pm(a, "claude-code", ...CSV);
    expect(d.code).toBe(0);
    const r = await pm(
      a,
      "claude-code",
      "release",
      "csv-export",
      "--abandon",
      "--session",
      sid(d.stdout),
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("csv-export abandoned");
  });

  test("release recreates the epic's worktree instead of switching the checkout", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const d = await pm(a, "claude-code", ...CSV);
    expect(d.code).toBe(0);
    const plain = await pm(a, "claude-code", "release", "csv-export", "--session", sid(d.stdout));
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
    const d = await pm(a, "claude-code", ...CSV);
    expect(d.code).toBe(0);
    const rel = await pm(a, "claude-code", "release", "csv-export", "--session", sid(d.stdout));
    expect(rel.code).toBe(0);
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
    const d1 = await pm(unclaimed, "claude-code", ...CSV);
    expect(d1.code).toBe(0);
    const rel1 = await pm(
      unclaimed,
      "claude-code",
      "release",
      "csv-export",
      "--session",
      sid(d1.stdout),
    );
    expect(rel1.code).toBe(0);
    await dropOrigin(unclaimed, "csv-export");
    const r1 = await pm(unclaimed, "claude-code", "release", "csv-export", "--no-worktree");
    expect(r1.code).toBe(1);
    expect(r1.stdout).toContain("already unclaimed");
    expect(await current(unclaimed)).toBe("main");

    const abandoned = (await remoteWithClones(await unclaimedSeed())).a;
    const d2 = await pm(abandoned, "claude-code", ...CSV);
    expect(d2.code).toBe(0);
    const rel2 = await pm(
      abandoned,
      "claude-code",
      "release",
      "csv-export",
      "--abandon",
      "--session",
      sid(d2.stdout),
    );
    expect(rel2.code).toBe(0);
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

  test("two sessions of one harness in one checkout: only the id holder may render or release", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const first = await pm(a, "claude-code", ...CSV);
    const id = sid(first.stdout);
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    const render = await pm(a, "claude-code", "render", "--epic", "csv-export");
    expect(render.code).toBe(1);
    expect(render.stdout).toContain("owned by claude-code");
    expect((await pm(a, "claude-code", "release", "csv-export")).code).toBe(1);
    const owned = await pm(a, "claude-code", "render", "--epic", "csv-export", "--session", id);
    expect(owned.code).toBe(0);
    expect((await pm(a, "claude-code", "release", "csv-export", "--session", id)).code).toBe(0);
  });

  test("two epics recorded at the same moment from two clones: both land, each branch INDEX keeps its own row, status lists both", async () => {
    const { a, b, bare } = await remoteWithClones(await unclaimedSeed());
    const claims = [
      { dir: a, harness: "claude-code", args: CSV, slug: "csv-export" },
      { dir: b, harness: "codex", args: SSO, slug: "sso-login" },
    ];
    const sids: string[] = [];
    for (const c of claims) {
      const r = await pm(c.dir, c.harness, ...c.args);
      expect(r.code).toBe(0);
      sids.push(sid(r.stdout));
    }
    const results = await Promise.all(
      claims.map(async (c, i) =>
        pmProcess(
          c.dir,
          [
            "record",
            c.slug,
            "--harness",
            c.harness,
            "--session",
            sids[i] ?? "missing",
            "--kind",
            "spec",
            "-m",
            `spec ${c.slug}`,
            "--from",
            "-",
          ],
          {
            harness: c.harness,
            stdin: await epicBundle(c.slug, ["epic.md", "plan.md"], {
              harness: c.harness,
              id: sids[i] ?? "missing",
            }),
          },
        ),
      ),
    );
    for (const r of results) expect(r.code).toBe(0);
    const refs = await gitOk(["ls-remote", bare, "pm/csv-export", "pm/sso-login"], a);
    expect(refs.trim().split("\n")).toHaveLength(2);
    const index = (slug: string) => gitOk(["show", `pm/${slug}:docs/pm/INDEX.md`], bare);
    const csvIndex = await index("csv-export");
    const ssoIndex = await index("sso-login");
    expect(csvIndex).toContain("[csv-export](csv-export/epic.md)");
    expect(csvIndex).not.toContain("sso-login");
    expect(ssoIndex).toContain("[sso-login](sso-login/epic.md)");
    expect(ssoIndex).not.toContain("csv-export");
    const third = await makeTempDir("ms-third");
    await gitOk(["clone", "-q", bare, third], third);
    const status = await pm(third, "pi", "status");
    expect(status.stdout).toContain("csv-export");
    expect(status.stdout).toContain("sso-login");
  });
});
