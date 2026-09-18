import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { epicBySlug, loadPmRepo } from "../scripts/repo";
import {
  attachEvidence,
  type EvidenceLine,
  extractPathTokens,
  formatEvidence,
  labelCriterion,
  matchPaths,
  parseCriteria,
  resolveRepos,
  resolveSince,
  resolveTarget,
  sinceSha,
  tokeniseCriterion,
} from "../scripts/verify";
import { buildWebshopRepo } from "./fixtures/build-webshop";
import { gitOk, initGitRepo, makeTempDir } from "./helpers";

/** Commit with author and committer date pinned, so --before/--since windows are deterministic. */
async function commitDated(dir: string, message: string, date: string): Promise<void> {
  await gitOk(["add", "-A"], dir);
  const proc = Bun.spawn(["git", "commit", "-q", "--allow-empty", "-m", message, "--date", date], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_COMMITTER_DATE: date },
  });
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
}

async function repoRootOf(dir: string): Promise<string> {
  return (await gitOk(["rev-parse", "--show-toplevel"], dir)).trim();
}

describe("extractPathTokens", () => {
  test("keeps slashed paths and known file extensions, strips trailing punctuation", () => {
    const body =
      "Edit app/app.py and app/schema.sql (see tests/). Results in docs/profile-results.txt.";
    expect(extractPathTokens(body)).toEqual([
      "app/app.py",
      "app/schema.sql",
      "tests/",
      "docs/profile-results.txt",
    ]);
  });
  test("drops relative doc links, urls, numbers, spec paths and non-file dotted words", () => {
    const body =
      "See ../epic.md and https://example.com/a/b. p95 3.4s, e.g. order_items.order_id; docs/pm/x/epic.md";
    expect(extractPathTokens(body)).toEqual([]);
  });
  test("dedupes", () => {
    expect(extractPathTokens("app/app.py then app/app.py again")).toEqual(["app/app.py"]);
  });
});

describe("matchPaths", () => {
  const listed = [
    "app/app.py",
    "app/schema.sql",
    "tests/test_orders.py",
    "docs/pm/app-performance/epic.md",
    "docs/profile-results.txt",
  ];
  test("exact, directory prefix and basename matches", () => {
    expect(matchPaths("app/app.py", listed)).toEqual(["app/app.py"]);
    expect(matchPaths("tests/", listed)).toEqual(["tests/test_orders.py"]);
    expect(matchPaths("app.py", listed)).toEqual(["app/app.py"]);
    expect(matchPaths("schema.sql", listed)).toEqual(["app/schema.sql"]);
  });
  test("never matches docs/pm and returns empty for unknown tokens", () => {
    expect(matchPaths("epic.md", listed)).toEqual([]);
    expect(matchPaths("app/migrations/", listed)).toEqual([]);
  });
});

describe("tokeniseCriterion", () => {
  test("paths, backticked and snake_case identifiers", () => {
    const t = tokeniseCriterion(
      "Migration under app/migrations/ creates an index on `order_items(order_id)`; sets max_rows",
    );
    expect(t.paths).toEqual(["app/migrations/"]);
    expect(t.idents).toEqual(["order_items(order_id)", "order_items", "order_id", "max_rows"]);
    expect(t.measured).toBe(false);
  });
  test("numbers with units or comparisons mark measured", () => {
    expect(tokeniseCriterion("GET /orders p95 under 1s on the T01 dataset").measured).toBe(true);
    expect(tokeniseCriterion("error rate < 0.1%").measured).toBe(true);
    expect(tokeniseCriterion("at least 3 retries").measured).toBe(true);
    expect(tokeniseCriterion("/orders issues O(1) queries per request").measured).toBe(false);
    expect(tokeniseCriterion("A results file records p50/p95 for /orders").measured).toBe(false);
  });
});

describe("parseCriteria", () => {
  test("reads checked state and text from the Acceptance criteria section only", () => {
    const body = `## What to do\n\n- [ ] not a criterion\n\n## Acceptance criteria\n\n- [ ] Migration file exists\n- [x] EXPLAIN shows the index\n\n## Out of scope\n\n- [ ] also not\n`;
    const c = parseCriteria(body);
    expect(c.map((x) => [x.text, x.checked])).toEqual([
      ["Migration file exists", false],
      ["EXPLAIN shows the index", true],
    ]);
  });
});

describe("attachEvidence + labelCriterion", () => {
  const line = (source: string, fact: string, paths: string[]): EvidenceLine => ({
    source,
    fact,
    repo: ".",
    paths,
  });
  test("attaches by path token and by identifier, leaves the rest unattributed", () => {
    const criteria = [
      tokeniseCriterion("Migration under app/migrations/ creates an index on order_items"),
      tokeniseCriterion("Response JSON unchanged"),
    ];
    const lines = [
      line("app/migrations/001.sql", "present, 1 lines, last changed abc 2026-09-12", [
        "app/migrations/001.sql",
      ]),
      line("app/schema.sql", "+CREATE INDEX idx_order_items_order_id ON order_items(order_id)", [
        "app/schema.sql",
      ]),
      line("git log", "abc 2026-09-12 restore pagination · app/app.py", ["app/app.py"]),
    ];
    const { attached, unattributed } = attachEvidence(criteria, lines);
    expect(attached[0]?.map((l) => l.source)).toEqual(["app/migrations/001.sql", "app/schema.sql"]);
    expect(attached[1]).toEqual([]);
    expect(unattributed.map((l) => l.source)).toEqual(["git log"]);
  });
  test("labels", () => {
    const plain = {
      checked: false,
      tokens: tokeniseCriterion("Migration under app/migrations/ exists"),
    };
    expect(labelCriterion(plain, 3)).toBe("evidence: 3 lines");
    expect(labelCriterion(plain, 1)).toBe("evidence: 1 line");
    expect(labelCriterion(plain, 0)).toBe("no evidence in scope");
    const measured = { checked: false, tokens: tokeniseCriterion("p95 under 1s") };
    expect(labelCriterion(measured, 2)).toBe("needs measurement");
    const measuredPath = {
      checked: false,
      tokens: tokeniseCriterion("app/app.py answers in < 1s"),
    };
    expect(labelCriterion(measuredPath, 2)).toBe("evidence: 2 lines");
    expect(labelCriterion({ ...plain, checked: true }, 0)).toBe(
      "already checked · no evidence in scope",
    );
  });
  test("formatEvidence", () => {
    const l = line("app/app.py", "+x", ["app/app.py"]);
    expect(formatEvidence(l, false)).toBe("[app/app.py] +x");
    expect(formatEvidence({ ...l, repo: "webshop" }, true)).toBe("[webshop:app/app.py] +x");
  });
});

describe("resolveSince", () => {
  test("--since wins, then task updated for in-progress/blocked, then epic created, then repo start", () => {
    const base = {
      taskStatus: "in-progress",
      taskUpdated: "2026-09-10",
      epicCreated: "2026-09-01",
    };
    expect(resolveSince({ ...base, sinceRef: "HEAD~2" })).toEqual({
      ref: "HEAD~2",
      reason: "--since",
    });
    expect(resolveSince(base)).toEqual({ date: "2026-09-10", reason: "task updated" });
    expect(resolveSince({ ...base, taskStatus: "blocked" })).toEqual({
      date: "2026-09-10",
      reason: "task updated",
    });
    expect(resolveSince({ ...base, taskStatus: "todo" })).toEqual({
      date: "2026-09-01",
      reason: "epic created",
    });
    expect(resolveSince({ taskStatus: "todo" })).toEqual({ reason: "repo start" });
  });
});

describe("sinceSha", () => {
  test("date picks the last commit before it; older dates resolve to root; refs resolve; bad refs error", async () => {
    const dir = await makeTempDir("since");
    await initGitRepo(dir);
    await commitDated(dir, "early", "2026-09-05T10:00:00");
    const early = (await gitOk(["rev-parse", "--short", "HEAD"], dir)).trim();
    await commitDated(dir, "late", "2026-09-12T10:00:00");
    const byDate = await sinceSha(dir, { date: "2026-09-10", reason: "task updated" }, 30_000);
    expect(byDate.since).toEqual({ date: "2026-09-10", sha: early, reason: "task updated" });
    const root = await sinceSha(dir, { date: "2020-01-01", reason: "epic created" }, 30_000);
    expect(root.since.sha).toBeNull();
    const byRef = await sinceSha(dir, { ref: "HEAD~1", reason: "--since" }, 30_000);
    expect(byRef.since.sha).toBe(early);
    const bad = await sinceSha(dir, { ref: "nope", reason: "--since" }, 30_000);
    expect(bad.error).toContain("--since nope");
  });
});

describe("resolveTarget + resolveRepos", () => {
  test("unmapped epic repos fall back to the orchestration repo with a gap", async () => {
    const dir = await makeTempDir("targets");
    await buildWebshopRepo(dir);
    const epic = epicBySlug(await loadPmRepo(dir), "app-performance");
    if (!epic) throw new Error("fixture epic missing");
    const r = await resolveRepos(dir, epic, undefined, {});
    if ("error" in r) throw new Error(r.error);
    expect(r.targets).toEqual([{ name: ".", path: dir }]);
    expect(r.gaps).toEqual([
      "git@github.com:glapsfun/webshop.git not checked out on this machine; map it in docs/pm/.local/repos.json",
      "no mapped repos; inspected the orchestration repo",
    ]);
  });
  test("mapped epic repos are inspected under their url basename", async () => {
    const dir = await makeTempDir("targets");
    await buildWebshopRepo(dir);
    const other = await makeTempDir("webshop-checkout");
    await initGitRepo(other);
    const epic = epicBySlug(await loadPmRepo(dir), "app-performance");
    if (!epic) throw new Error("fixture epic missing");
    const r = await resolveRepos(dir, epic, undefined, {
      "git@github.com:glapsfun/webshop.git": other,
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.targets).toEqual([{ name: "webshop", path: await repoRootOf(other) }]);
    expect(r.gaps).toEqual([]);
  });
  test("--repo by name, by path, unknown name lists known names, non-git path errors", async () => {
    const dir = await makeTempDir("targets");
    await buildWebshopRepo(dir);
    const other = await makeTempDir("other");
    await initGitRepo(other);
    const plain = await makeTempDir("plain");
    const map = { "git@github.com:acme/infra.git": other };
    expect(await resolveTarget(dir, "git@github.com:acme/infra.git", map)).toEqual({
      target: { name: "infra", path: await repoRootOf(other) },
    });
    expect(await resolveTarget(dir, other, map)).toEqual({
      target: { name: basename(other), path: await repoRootOf(other) },
    });
    const unknown = await resolveTarget(dir, "nope", map);
    expect("error" in unknown && unknown.error).toContain(
      "known names in docs/pm/.local/repos.json: git@github.com:acme/infra.git",
    );
    const notGit = await resolveTarget(dir, plain, map);
    expect("error" in notGit && notGit.error).toContain("not inside a git repository");
  });
});
