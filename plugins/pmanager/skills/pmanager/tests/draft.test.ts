import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { release, remoteEpicOf } from "../scripts/claim";
import { parseDoc, sessionOf } from "../scripts/contract";
import { draftClaim, stubEpic } from "../scripts/draft";
import { fetchOrigin, gitOk, listRemoteBranches } from "../scripts/git";
import { worktreePath } from "../scripts/worktree";
import { exists, initGitRepo, makeTempDir, remoteWithClones, unclaimedSeed } from "./helpers";

const OPTS = {
  harness: "claude-code",
  today: "2026-09-28",
  title: "CSV export for reports",
  type: "feature",
  distinct: false,
};

describe("stubEpic", () => {
  test("draft frontmatter with the session block; titles are quoted when needed", () => {
    const raw = stubEpic("csv-export", {
      title: "Export: CSV for reports",
      type: "feature",
      today: "2026-09-28",
      session: { harness: "pi", claimed: "2026-09-28", branch: "pm/csv-export" },
    });
    const doc = parseDoc("epic.md", raw);
    expect(doc.frontmatter.title).toBe("Export: CSV for reports");
    expect(doc.frontmatter.status).toBe("draft");
    expect(doc.frontmatter.contract).toBe("1");
    expect(doc.frontmatter.repos).toEqual([]);
    expect(sessionOf(doc.frontmatter)).toEqual({
      harness: "pi",
      claimed: "2026-09-28",
      branch: "pm/csv-export",
    });
    expect(doc.body).toContain("Research in progress; framing happens in Phase 4.");
  });
});

describe("draftClaim", () => {
  test("writes the stub in its own worktree, pushes, and leaves the checkout untouched", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(true);
    const wt = worktreePath(a, "csv-export");
    expect(await readFile(join(wt, "docs/pm/csv-export/epic.md"), "utf8")).toContain(
      "status: draft",
    );
    expect(await exists(join(a, "docs/pm/csv-export"))).toBe(false);
    expect((await gitOk(["status", "--porcelain"], a)).trim()).toBe("");
    expect(await listRemoteBranches(a, "pm/")).toContain("pm/csv-export");
    await fetchOrigin(b);
    expect((await remoteEpicOf(b, "csv-export"))?.status).toBe("draft");
  });

  test("refuses a taken slug, an existing epic, and a look-alike unless --distinct", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await draftClaim(a, "csv-export", OPTS)).ok).toBe(true);
    const taken = await draftClaim(b, "csv-export", { ...OPTS, harness: "pi" });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.reason).toBe("taken");
    const here = await draftClaim(b, "app-performance", { ...OPTS, title: "Something else" });
    expect(here.ok).toBe(false);
    if (!here.ok) expect(here.reason).toBe("exists");
    const alike = await draftClaim(b, "orders-page-slow", {
      ...OPTS,
      title: "Orders page is slow",
      type: "bug",
    });
    expect(alike.ok).toBe(false);
    if (!alike.ok) {
      expect(alike.reason).toBe("look-alike");
      expect(alike.lookAlikes?.map((e) => e.slug)).toEqual(["app-performance"]);
      expect(alike.message).toContain("--distinct");
    }
    const csvAlike = await draftClaim(b, "reports-csv-download", {
      ...OPTS,
      title: "Download reports as CSV",
    });
    expect(csvAlike.ok).toBe(false);
    if (!csvAlike.ok) expect(csvAlike.lookAlikes?.map((e) => e.slug)).toEqual(["csv-export"]);
    const distinct = await draftClaim(b, "reports-csv-download", {
      ...OPTS,
      title: "Download reports as CSV",
      distinct: true,
    });
    expect(distinct.ok).toBe(true);
  });

  test("a local pm/<slug> branch without a remote one is refused", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    await gitOk(["branch", "pm/csv-export"], a);
    const r = await draftClaim(a, "csv-export", OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("taken");
      expect(r.message).toContain("local pm/csv-export branch");
    }
  });

  test("works on a cold start without docs/pm; needs a remote", async () => {
    const { a } = await remoteWithClones({ "README.md": "# app\n" });
    expect((await draftClaim(a, "csv-export", OPTS)).ok).toBe(true);
    const plain = await makeTempDir("draft-plain");
    await initGitRepo(plain);
    const none = await draftClaim(plain, "csv-export", OPTS);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe("no-remote");
  });

  test("simultaneous drafts of one slug yield exactly one winner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const [ra, rb] = await Promise.all([
      draftClaim(a, "csv-export", OPTS),
      draftClaim(b, "csv-export", { ...OPTS, harness: "pi" }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect(await listRemoteBranches(a, "pm/")).toEqual(["pm/csv-export"]);
  });

  test("release --abandon marks the draft abandoned, keeps the branch, frees the idea", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await draftClaim(a, "csv-export", OPTS)).ok).toBe(true);
    const r = await release(a, "csv-export", {
      harness: "claude-code",
      today: "2026-09-29",
      abandon: true,
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("abandoned");
    await fetchOrigin(b);
    const remote = await remoteEpicOf(b, "csv-export");
    expect(remote?.status).toBe("abandoned");
    expect(remote?.session).toBeNull();
    const sameSlug = await draftClaim(b, "csv-export", { ...OPTS, harness: "pi" });
    expect(sameSlug.ok).toBe(false);
    const newSlug = await draftClaim(b, "reports-csv-download", {
      ...OPTS,
      harness: "pi",
      title: "Download reports as CSV",
    });
    expect(newSlug.ok).toBe(true);
  });
});
