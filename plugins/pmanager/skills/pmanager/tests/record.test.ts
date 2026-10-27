import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exists,
  gitOk,
  initGitRepo,
  makeTempDir,
  remoteWithClones,
  unclaimedSeed,
  writeTree,
} from "./helpers";

const PM = join(import.meta.dir, "..", "scripts", "pm.ts");
const SLUG = "app-performance";
const PLAN = `docs/pm/${SLUG}/plan.md`;
const NEW_LINE = "| 2026-09-15 | recorded | test |";

async function run(args: string[], cwd: string, stdin?: string) {
  const proc = Bun.spawn(["bun", "run", PM, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin === undefined ? undefined : new Blob([stdin]),
    env: { ...process.env, PM_TODAY: "2026-09-15", PM_HARNESS: "test-harness" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

const sid = (stdout: string) => /session: ([0-9a-f]{6})/.exec(stdout)?.[1] ?? "missing";

async function localUnclaimed() {
  const root = await makeTempDir("record");
  await writeTree(root, await unclaimedSeed());
  await initGitRepo(root);
  await gitOk(["add", "-A"], root);
  await gitOk(["commit", "-q", "-m", "seed"], root);
  return root;
}

async function bundle(slug: string, extra = ""): Promise<string> {
  const plan = await readFile(join(import.meta.dir, "fixtures/webshop", PLAN), "utf8");
  return `<!-- pm:file ${slug}/plan.md -->\n${plan.trimEnd()}\n${NEW_LINE}\n${extra}`;
}

const rec = (cwd: string, stdin: string | undefined, ...more: string[]) =>
  run(["record", SLUG, "--kind", "spec", "-m", "spec app-performance", ...more], cwd, stdin);

const logFiles = async (root: string) =>
  (await readdir(join(root, "docs/pm/log"))).filter((n) => n.startsWith(`2026-09-15-${SLUG}-`));

const head = (cwd: string) => gitOk(["rev-parse", "HEAD"], cwd);

const committed = async (cwd: string) =>
  (await gitOk(["show", "--name-only", "--format=", "HEAD"], cwd)).split("\n").filter(Boolean);

/** A second epic, `other`, copied from app-performance and committed. */
async function addOtherEpic(root: string): Promise<void> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(await unclaimedSeed())) {
    if (!path.startsWith(`docs/pm/${SLUG}/`)) continue;
    files[path.replace(`/${SLUG}/`, "/other/")] = content
      .replace(`id: ${SLUG}`, "id: other")
      .replace(`epic: ${SLUG}`, "epic: other");
  }
  await writeTree(root, files);
  await gitOk(["add", "-A"], root);
  await gitOk(["commit", "-q", "-m", "other epic"], root);
}

describe("pm record", () => {
  test("no remote: commits on the current branch, unpushed, no trailer", async () => {
    const root = await localUnclaimed();
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/committed [0-9a-f]{7} on main, unpushed: no claim/);
    expect(await gitOk(["log", "-1", "--format=%B"], root)).toBe(
      "docs(pm): spec app-performance\n\n",
    );
    expect(await logFiles(root)).toHaveLength(1);
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], root)).trim()).toBe("main");
  });

  test("claimed: commits in the worktree and pushes pm/<slug>", async () => {
    const { bare, a } = await remoteWithClones(await unclaimedSeed());
    const before = await head(a);
    const claim = await run(["claim", SLUG], a);
    const r = await rec(a, await bundle(SLUG), "--from", "-", "--session", sid(claim.stdout));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(", pushed");
    expect((await gitOk(["log", "-1", "--format=%s", `pm/${SLUG}`], bare)).trim()).toBe(
      `docs(pm): spec ${SLUG}`,
    );
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], a)).trim()).toBe("main");
    expect(await head(a)).toBe(before);
  });

  test("another session's claim is refused before writing", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const claim = await run(["claim", SLUG], a);
    const wt = /worktree: (.+)/.exec(claim.stdout)?.[1] ?? "";
    const plan = await readFile(join(wt, PLAN), "utf8");
    const r = await rec(a, await bundle(SLUG), "--from", "-", "--session", "ffffff");
    expect(r.code).toBe(1);
    expect(await readFile(join(wt, PLAN), "utf8")).toBe(plan);
  });

  test("remote but unclaimed: refused before writing", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    const before = await head(a);
    const plan = await readFile(join(a, PLAN), "utf8");
    const r = await rec(a, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "not committed: app-performance is not claimed; run pm claim app-performance first",
    );
    expect(await head(a)).toBe(before);
    expect(await readFile(join(a, PLAN), "utf8")).toBe(plan);
    expect(await readFile(join(a, PLAN), "utf8")).not.toContain(NEW_LINE);
    expect(await logFiles(a)).toHaveLength(0);
    expect((await gitOk(["status", "--porcelain"], a)).trim()).toBe("");
    expect(r.stdout).not.toContain("no findings");
  });

  test("unreachable origin: commits on the current branch like no remote", async () => {
    const root = await localUnclaimed();
    await gitOk(["remote", "add", "origin", join(root, "no-such-origin.git")], root);
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/committed [0-9a-f]{7} on main, unpushed: origin unreachable/);
    expect((await gitOk(["log", "-1", "--format=%s"], root)).trim()).toBe(`docs(pm): spec ${SLUG}`);
    expect((await gitOk(["rev-parse", "--abbrev-ref", "HEAD"], root)).trim()).toBe("main");
    expect(await gitOk(["branch", "--list", "pm/*"], root)).toBe("");
    const worktrees = await gitOk(["worktree", "list", "--porcelain"], root);
    expect(worktrees.match(/^worktree /gm)).toHaveLength(1);
    expect(await exists(`${root}-pm-${SLUG}`)).toBe(false);
  });

  test("a repository with no commits: the first commit lands on the unborn branch", async () => {
    const root = await makeTempDir("record-unborn");
    await gitOk(["init", "-q", "-b", "trunk"], root);
    await gitOk(["config", "user.name", "test"], root);
    await gitOk(["config", "user.email", "test@example.com"], root);
    await writeTree(root, await unclaimedSeed());
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/committed [0-9a-f]{7} on trunk, unpushed: no claim/);
    expect((await gitOk(["rev-list", "--count", "HEAD"], root)).trim()).toBe("1");
    expect((await gitOk(["symbolic-ref", "--short", "HEAD"], root)).trim()).toBe("trunk");
    expect(await committed(root)).toContain(PLAN);
  });

  test("another epic's re-rendered plan stays out of the commit", async () => {
    const root = await localUnclaimed();
    await addOtherEpic(root);
    const task = "docs/pm/other/tasks/T01-benchmark-orders.md";
    const raw = await readFile(join(root, task), "utf8");
    await writeFile(join(root, task), raw.replace("status: todo", "status: in-progress"));
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("docs/pm/other/plan.md");
    const status = await gitOk(["status", "--porcelain"], root);
    expect(status).toContain(` M ${task}`);
    expect(status).toContain(" M docs/pm/other/plan.md");
    const files = await committed(root);
    expect(files).toContain(PLAN);
    expect(files).not.toContain(task);
    expect(files).not.toContain("docs/pm/other/plan.md");
  });

  test("another epic's staged file stays staged and out of the commit", async () => {
    const root = await localUnclaimed();
    await addOtherEpic(root);
    const task = "docs/pm/other/tasks/T01-benchmark-orders.md";
    await writeFile(join(root, task), `${await readFile(join(root, task), "utf8")}\nstaged note\n`);
    await gitOk(["add", task], root);
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(await gitOk(["diff", "--cached", "--name-only"], root)).toBe(`${task}\n`);
    expect(await committed(root)).not.toContain(task);
  });

  test("an unreadable --from names the file", async () => {
    const root = await localUnclaimed();
    const missing = join(root, "no-such-bundle.md");
    const r = await rec(root, undefined, "--from", missing);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`cannot read ${missing}\n`);
  });

  test("check errors: nothing committed, rerun commits with one log entry", async () => {
    const root = await localUnclaimed();
    const before = await head(root);
    const broken = `<!-- pm:file ${SLUG}/tasks/T05-broken.md -->\nno frontmatter here\n`;
    const r = await rec(root, await bundle(SLUG, broken), "--from", "-");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("not committed: check errors");
    expect(await head(root)).toBe(before);
    await rm(join(root, `docs/pm/${SLUG}/tasks/T05-broken.md`));
    const again = await rec(root, undefined);
    expect(again.code).toBe(0);
    expect(await logFiles(root)).toHaveLength(1);
  });

  test("rerun with the same bundle reuses the log entry", async () => {
    const root = await localUnclaimed();
    const broken = `<!-- pm:file ${SLUG}/tasks/T05-broken.md -->\nno frontmatter here\n`;
    expect((await rec(root, await bundle(SLUG, broken), "--from", "-")).code).toBe(1);
    await rm(join(root, `docs/pm/${SLUG}/tasks/T05-broken.md`));
    const again = await rec(root, await bundle(SLUG), "--from", "-");
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("(reused)");
    expect(await logFiles(root)).toHaveLength(1);
  });

  test("commits only its own paths", async () => {
    const root = await localUnclaimed();
    const other = join(root, "docs/pm/log/2026-09-10-app-performance-a1b2c3.md");
    await writeFile(other, `${await readFile(other, "utf8")}\nedited\n`);
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(await gitOk(["status", "--porcelain"], root)).toContain(
      " M docs/pm/log/2026-09-10-app-performance-a1b2c3.md",
    );
  });

  test("from a subdirectory", async () => {
    const root = await localUnclaimed();
    const r = await rec(join(root, "app"), await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(await readFile(join(root, PLAN), "utf8")).toContain(NEW_LINE);
    expect(await exists(join(root, "app/docs"))).toBe(false);
    expect((await gitOk(["log", "-1", "--format=%s"], root)).trim()).toBe(`docs(pm): spec ${SLUG}`);
  });

  test("not a git repository", async () => {
    const root = await makeTempDir("record-nogit");
    await writeTree(root, await unclaimedSeed());
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("not committed: not a git repository");
    expect(await readFile(join(root, PLAN), "utf8")).toContain(NEW_LINE);
    expect(await logFiles(root)).toHaveLength(1);
  });

  test("staged changes outside docs/pm", async () => {
    const root = await localUnclaimed();
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app/extra.py"), "x = 1\n");
    await gitOk(["add", "app/extra.py"], root);
    const before = await head(root);
    const r = await rec(root, await bundle(SLUG), "--from", "-");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("not committed: staged changes outside docs/pm");
    expect(await gitOk(["diff", "--cached", "--name-only"], root)).toBe("app/extra.py\n");
    expect(await head(root)).toBe(before);
  });

  const cases: [string, string[], string, string][] = [
    ["no -m", ["record", SLUG, "--kind", "spec", "--from", "-"], SLUG, "ok"],
    ["--kind other", ["record", SLUG, "--kind", "other", "-m", "x", "--from", "-"], SLUG, "ok"],
    ["bad slug", ["record", "Bad_Slug", "--kind", "spec", "-m", "x", "--from", "-"], SLUG, "ok"],
    ["unknown epic", ["record", "nope", "--kind", "spec", "-m", "x", "--from", "-"], "nope", "ok"],
    [
      "INDEX.md in bundle",
      ["record", SLUG, "--kind", "spec", "-m", "x", "--from", "-"],
      SLUG,
      "index",
    ],
  ];
  test.each(cases)("usage error exits 2 and writes nothing: %s", async (_n, args, slug, mode) => {
    const root = await localUnclaimed();
    const stdin = mode === "index" ? "<!-- pm:file INDEX.md -->\nx\n" : await bundle(slug);
    const r = await run(args, root, stdin);
    expect(r.code).toBe(2);
    expect(await gitOk(["status", "--porcelain"], root)).toBe("");
  });

  test("a slug that prefixes another never reuses its log entry", async () => {
    const root = await localUnclaimed();
    const seed = await unclaimedSeed();
    const appEpic = (seed[`docs/pm/${SLUG}/epic.md`] ?? "")
      .replace("id: app-performance", "id: app")
      .replace("# Fix orders page latency", "# Fix orders page latency\n");
    const appPlan = seed[`docs/pm/${SLUG}/plan.md`] ?? "";
    await writeTree(root, { "docs/pm/app/epic.md": appEpic, "docs/pm/app/plan.md": appPlan });
    await gitOk(["add", "-A"], root);
    await gitOk(["commit", "-q", "-m", "app epic"], root);
    const broken = `<!-- pm:file ${SLUG}/tasks/T05-broken.md -->\nno frontmatter here\n`;
    expect((await rec(root, await bundle(SLUG, broken), "--from", "-")).code).toBe(1);
    const [other] = await logFiles(root);
    await rm(join(root, `docs/pm/${SLUG}/tasks/T05-broken.md`));
    const stdin = `<!-- pm:file app/epic.md -->\n${appEpic.replace("App shell", "App shell v2")}`;
    const r = await run(
      ["record", "app", "--kind", "update", "-m", "update app", "--from", "-"],
      root,
      stdin,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("(reused)");
    const logs = await readdir(join(root, "docs/pm/log"));
    const mine = logs.filter((n) => /^2026-09-15-app-[0-9a-f]{6}\.md$/.test(n));
    expect(mine).toHaveLength(1);
    expect(await readFile(join(root, "docs/pm/log", mine[0] ?? ""), "utf8")).toContain(
      "epic: app\n",
    );
    const status = await gitOk(["status", "--porcelain", "--untracked-files=all"], root);
    expect(status).toContain(`?? docs/pm/log/${other}`);
  });

  test("--json", async () => {
    const root = await localUnclaimed();
    const r = await rec(root, await bundle(SLUG), "--from", "-", "--json");
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.push).toBe("no-claim");
    expect(j.commit.branch).toBe("main");
    expect(j.wrote).toEqual([`${SLUG}/plan.md`]);
  });
});
