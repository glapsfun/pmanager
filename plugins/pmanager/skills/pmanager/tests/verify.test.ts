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
  listFiles,
  matchPaths,
  parseCriteria,
  parseNameOnlyLog,
  probeNamedPaths,
  probeTaggedCommits,
  probeWindowedChanges,
  resolveRepos,
  resolveSince,
  resolveTarget,
  type Since,
  sinceSha,
  tokeniseCriterion,
  type VerifyProbeOptions,
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

const ROOT_SINCE: Since = { date: null, sha: null, reason: "repo start" };

function opts(cwd: string, over: Partial<VerifyProbeOptions> = {}): VerifyProbeOptions {
  return {
    cwd,
    repo: ".",
    since: ROOT_SINCE,
    taskId: "T02",
    slug: "app-performance",
    tokens: [],
    extraFiles: [],
    limit: 20,
    timeoutMs: 30_000,
    ...over,
  };
}

const MIGRATION = "app/migrations/001_order_items_index.sql";
const INDEX_SQL = "CREATE INDEX idx_order_items_order_id ON order_items(order_id);";

/** Webshop fixture plus an index migration committed as T02 work on 2026-09-12. */
async function webshopWithMigration(): Promise<{ dir: string; sha: string }> {
  const dir = await makeTempDir("verify");
  await buildWebshopRepo(dir);
  await mkdir(join(dir, "app", "migrations"), { recursive: true });
  await writeFile(join(dir, MIGRATION), `${INDEX_SQL}\n`);
  await commitDated(dir, "add order_items index (T02)", "2026-09-12T10:00:00");
  const sha = (await gitOk(["rev-parse", "--short", "HEAD"], dir)).trim();
  return { dir, sha };
}

describe("listFiles", () => {
  test("tracked and untracked, spec docs excluded", async () => {
    const { dir } = await webshopWithMigration();
    await writeFile(join(dir, "docs", "profile-results.txt"), "p50 2.9s  p95 3.4s\n");
    const l = await listFiles(dir, 30_000);
    expect(l.tracked).toContain("app/app.py");
    expect(l.tracked.some((p) => p.startsWith("docs/pm/"))).toBe(false);
    expect(l.untracked).toEqual(["docs/profile-results.txt"]);
  });
});

describe("probeNamedPaths", () => {
  test("present files with last change, untracked files, missing tokens", async () => {
    const { dir, sha } = await webshopWithMigration();
    await writeFile(join(dir, "docs", "profile-results.txt"), "p50 2.9s\np95 3.4s\n");
    const l = await listFiles(dir, 30_000);
    const p = await probeNamedPaths(
      opts(dir, {
        tokens: ["app/migrations/", "app/nothing.py", "and/or"],
        extraFiles: ["docs/profile-results.txt"],
      }),
      [...l.tracked, ...l.untracked],
    );
    const facts = Object.fromEntries(p.lines.map((x) => [x.source, x.fact]));
    expect(facts[MIGRATION]).toBe(`present, 1 lines, last changed ${sha} 2026-09-12`);
    expect(facts["docs/profile-results.txt"]).toBe("present, 2 lines, untracked");
    expect(facts["app/nothing.py"]).toBe("missing");
    expect(facts["and/or"]).toBeUndefined();
    expect(p.files.sort()).toEqual([MIGRATION, "docs/profile-results.txt"]);
  });
});

describe("parseNameOnlyLog", () => {
  test("splits header lines from file lists", () => {
    const out = parseNameOnlyLog(
      "\u0001abc\t2026-09-12\tadd index (T02)\n\napp/schema.sql\ndocs/pm/x/plan.md\n\u0001def\t2026-09-13\tdocs only\n\ndocs/pm/x/epic.md\n",
    );
    expect(out).toEqual([
      {
        sha: "abc",
        date: "2026-09-12",
        subject: "add index (T02)",
        files: ["app/schema.sql", "docs/pm/x/plan.md"],
      },
      { sha: "def", date: "2026-09-13", subject: "docs only", files: ["docs/pm/x/epic.md"] },
    ]);
  });
});

describe("probeTaggedCommits", () => {
  test("finds commits by task id or slug, drops spec-only commits, honours the bound", async () => {
    const { dir, sha } = await webshopWithMigration();
    const all = await probeTaggedCommits(opts(dir));
    expect(all.lines.map((l) => l.fact)).toEqual([
      `${sha} 2026-09-12 add order_items index (T02) · ${MIGRATION}`,
    ]);
    expect(all.commits).toBe(1);
    expect(all.files).toEqual([MIGRATION]);
    const none = await probeTaggedCommits(
      opts(dir, { since: { date: null, sha, reason: "--since" } }),
    );
    expect(none.lines).toEqual([]);
    expect(none.commits).toBe(0);
  });
});

describe("probeWindowedChanges", () => {
  test("numstat and worktree lines under named prefixes", async () => {
    const { dir } = await webshopWithMigration();
    const schema = join(dir, "app", "schema.sql");
    await writeFile(schema, `${await Bun.file(schema).text()}-- tweak\n`);
    await writeFile(join(dir, "docs", "profile-results.txt"), "p50 2.9s\n");
    const p = await probeWindowedChanges(
      opts(dir, { tokens: ["app/schema.sql"], extraFiles: ["docs/profile-results.txt"] }),
    );
    const facts = p.lines.map((l) => `[${l.source}] ${l.fact}`);
    expect(facts.some((f) => /^\[git diff\] app\/schema\.sql \+\d+ -0 since root$/.test(f))).toBe(
      true,
    );
    expect(facts).toContain("[worktree] app/schema.sql modified, uncommitted");
    expect(facts).toContain("[worktree] docs/profile-results.txt untracked");
    expect(p.uncommitted).toBe(2);
    expect(p.files.sort()).toEqual(["app/schema.sql", "docs/profile-results.txt"]);
  });
  test("no prefixes means no lines", async () => {
    const { dir } = await webshopWithMigration();
    expect(await probeWindowedChanges(opts(dir))).toEqual({ lines: [], files: [], uncommitted: 0 });
  });
});
