import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claim, claimBranch, release, remoteSessionOf } from "../scripts/claim";
import { parseDoc, sessionOf } from "../scripts/contract";
import { currentBranch, fetchOrigin, listRemoteBranches } from "../scripts/git";
import { fixtureFiles, initGitRepo, makeTempDir, remoteWithClones, writeTree } from "./helpers";

const SLUG = "app-performance";
const EPIC = `docs/pm/${SLUG}/epic.md`;
const SESSION_BLOCK =
  "session:\n  harness: claude-code\n  claimed: 2026-09-10\n  branch: pm/app-performance\n";

export async function unclaimedSeed() {
  const files = await fixtureFiles();
  files[EPIC] = (files[EPIC] ?? "").replace(SESSION_BLOCK, "");
  files["docs/pm/INDEX.md"] = (files["docs/pm/INDEX.md"] ?? "").replace(
    "claude-code · 2026-09-10",
    "—",
  );
  return files;
}

const OPTS = { harness: "claude-code", takeover: false, staleDays: 14, today: "2026-09-15" };

describe("claim", () => {
  test("first claim wins, second is taken", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const first = await claim(a, SLUG, OPTS);
    expect(first.ok).toBe(true);
    expect(await currentBranch(a)).toBe(claimBranch(SLUG));
    expect(await listRemoteBranches(a, "pm/")).toEqual(["pm/app-performance"]);
    const epic = parseDoc(EPIC, await readFile(join(a, EPIC), "utf8"));
    expect(sessionOf(epic.frontmatter)).toEqual({
      harness: "claude-code",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
    const second = await claim(b, SLUG, { ...OPTS, harness: "pi" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("taken");
      expect(second.owner?.harness).toBe("claude-code");
    }
    expect(await currentBranch(b)).toBe("main");
    expect(await remoteSessionOf(b, SLUG)).toEqual({
      harness: "claude-code",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
  });

  test("simultaneous claims yield exactly one winner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    const [ra, rb] = await Promise.all([
      claim(a, SLUG, OPTS),
      claim(b, SLUG, { ...OPTS, harness: "pi" }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect(await listRemoteBranches(a, "pm/")).toEqual(["pm/app-performance"]);
  });

  test("release then claim by another session: branch still marks it taken", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await claim(a, SLUG, OPTS)).ok).toBe(true);
    const rel = await release(a, SLUG, { harness: "claude-code", today: "2026-09-16" });
    expect(rel.ok).toBe(true);
    expect(await remoteSessionOf(b, SLUG)).toBeNull();
    const again = await claim(b, SLUG, { ...OPTS, harness: "pi" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("taken");
  });

  test("takeover allowed only on stale claim and records previous owner", async () => {
    const { a, b } = await remoteWithClones(await unclaimedSeed());
    expect((await claim(a, SLUG, { ...OPTS, today: "2026-08-01" })).ok).toBe(true);
    const tooEarly = await claim(b, SLUG, {
      ...OPTS,
      harness: "pi",
      takeover: true,
      today: "2026-08-05",
    });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.reason).toBe("not-stale");
    const late = await claim(b, SLUG, {
      ...OPTS,
      harness: "pi",
      takeover: true,
      today: "2026-09-15",
    });
    expect(late.ok).toBe(true);
    expect(await currentBranch(b)).toBe("pm/app-performance");
    const epic = await readFile(join(b, EPIC), "utf8");
    expect(epic).toContain("harness: pi");
    const plan = await readFile(join(b, `docs/pm/${SLUG}/plan.md`), "utf8");
    expect(plan).toContain("taken over from claude-code");
    await fetchOrigin(a);
    expect(await remoteSessionOf(a, SLUG)).toEqual({
      harness: "pi",
      claimed: "2026-09-15",
      branch: "pm/app-performance",
    });
  });

  test("no epic and no remote are reported", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const missing = await claim(a, "nope", OPTS);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("no-epic");
    const lonely = await makeTempDir("lonely");
    await initGitRepo(lonely);
    await writeTree(lonely, await unclaimedSeed());
    const r = await claim(lonely, SLUG, OPTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-remote");
  });
});
