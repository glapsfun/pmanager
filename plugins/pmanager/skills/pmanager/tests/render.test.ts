import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { contractVersion, getString } from "../scripts/contract";
import {
  applyRender,
  LOG_START,
  markerState,
  migrate,
  planRender,
  renderIndex,
  renderMemoLog,
  renderTaskTable,
  replaceBetweenMarkers,
  repoShortName,
  TASKS_END,
  TASKS_START,
  taskCounts,
} from "../scripts/render";
import { loadPmRepo } from "../scripts/repo";
import { copyFixture, makeTempDir, writeTree } from "./helpers";

async function fixtureRepo() {
  const root = await makeTempDir("render");
  await copyFixture(root);
  return { root, repo: await loadPmRepo(root) };
}

describe("repoShortName", () => {
  test("ssh and https forms", () => {
    expect(repoShortName("git@github.com:glapsfun/webshop.git")).toBe("glapsfun/webshop");
    expect(repoShortName("https://github.com/glapsfun/webshop")).toBe("glapsfun/webshop");
    expect(repoShortName("https://gitlab.com/g/sub/repo.git")).toBe("g/sub/repo");
    expect(repoShortName("weird")).toBe("weird");
  });
});

describe("render matches the fixture byte for byte", () => {
  test("index", async () => {
    const { root, repo } = await fixtureRepo();
    expect(renderIndex(repo)).toBe(await readFile(join(root, "docs/pm/INDEX.md"), "utf8"));
  });
  test("plan task table", async () => {
    const { repo } = await fixtureRepo();
    const epic = repo.epics[0];
    if (!epic) throw new Error("fixture epic missing");
    const table = renderTaskTable(epic);
    expect(table.startsWith(`${TASKS_START}\n`)).toBe(true);
    expect(table.endsWith(`${TASKS_END}\n`)).toBe(true);
    expect(epic.plan?.raw).toContain(table);
  });
  test("memo log", async () => {
    const { repo } = await fixtureRepo();
    const log = renderMemoLog(repo);
    expect(log.startsWith(`${LOG_START}\n`)).toBe(true);
    expect(repo.memo?.raw).toContain(log);
  });
  test("planRender is empty on a clean fixture", async () => {
    const { repo } = await fixtureRepo();
    expect(planRender(repo)).toEqual([]);
  });
  test("taskCounts excludes descoped", async () => {
    const { repo } = await fixtureRepo();
    const epic = repo.epics[0];
    if (!epic) throw new Error("fixture epic missing");
    expect(taskCounts(epic)).toEqual({ done: 0, total: 4 });
  });
});

describe("planRender / applyRender", () => {
  test("detects a stale index after a task status change and rewrites it", async () => {
    const { root } = await fixtureRepo();
    const t01 = join(root, "docs/pm/app-performance/tasks/T01-benchmark-orders.md");
    await Bun.write(t01, (await readFile(t01, "utf8")).replace("status: todo", "status: done"));
    const repo = await loadPmRepo(root);
    const planned = planRender(repo);
    expect(planned.map((f) => f.path.replace(`${root}/`, "")).sort()).toEqual([
      "docs/pm/INDEX.md",
      "docs/pm/app-performance/plan.md",
    ]);
    const written = await applyRender(repo);
    expect(written).toHaveLength(2);
    const again = await loadPmRepo(root);
    expect(planRender(again)).toEqual([]);
    expect(again.index).toContain("| 1/4 |");
    expect(again.epics[0]?.plan?.raw).toContain(
      "| T01 | Benchmark orders endpoint | M1 | must | — | done |",
    );
  });
  test("creates INDEX.md and memo log region when missing", async () => {
    const root = await makeTempDir("render");
    await writeTree(root, {
      "docs/pm/z/epic.md":
        "---\nid: z\ntitle: Z\ntype: feature\nstatus: draft\nowner: me\ncreated: 2026-09-15\nupdated: 2026-09-15\ncontract: 1\nrepos: []\nprimary-metric: adoption > 10%\n---\n\n# Z\n",
    });
    const repo = await loadPmRepo(root);
    const files = planRender(repo).map((f) => f.path.replace(`${root}/`, ""));
    expect(files).toEqual(["docs/pm/INDEX.md"]);
    await applyRender(repo);
    const idx = await readFile(join(root, "docs/pm/INDEX.md"), "utf8");
    expect(idx).toContain(
      "| [z](z/epic.md) | Z | feature | draft | me | — | — | 0/0 | adoption > 10% | 2026-09-15 |",
    );
  });
  test("sorts index newest first, then slug", async () => {
    const root = await makeTempDir("render");
    const mk = (id: string, created: string) =>
      `---\nid: ${id}\ntitle: ${id}\ntype: bug\nstatus: draft\nowner: x\ncreated: ${created}\nupdated: ${created}\ncontract: 1\nrepos: []\nprimary-metric: m\n---\n`;
    await writeTree(root, {
      "docs/pm/b/epic.md": mk("b", "2026-09-01"),
      "docs/pm/a/epic.md": mk("a", "2026-09-01"),
      "docs/pm/c/epic.md": mk("c", "2026-09-02"),
    });
    const idx = renderIndex(await loadPmRepo(root));
    const order = [...idx.matchAll(/\| \[(\w)\]/g)].map((m) => m[1]);
    expect(order).toEqual(["c", "a", "b"]);
  });
});

describe("markerState", () => {
  test("classifies pairs", () => {
    const S = TASKS_START;
    const E = TASKS_END;
    expect(markerState(`a\n${S}\nx\n${E}\n`, S, E)).toBe("ok");
    expect(markerState("nothing", S, E)).toBe("missing");
    expect(markerState(`${S}\nx\n`, S, E)).toBe("unterminated");
    expect(markerState(`${E}\nx\n${S}\n`, S, E)).toBe("misordered");
    expect(markerState(`${S}\n${S}\n${E}\n`, S, E)).toBe("duplicate");
    expect(markerState(`${S}\nx\n${E}\n${E}\n`, S, E)).toBe("duplicate");
    expect(markerState(`${S}\nx\n${E}\n${S}\n`, S, E)).toBe("duplicate");
  });
});

describe("replaceBetweenMarkers", () => {
  test("replaces inclusive of markers, null when missing", () => {
    const text = `a\n${TASKS_START}\nold\n${TASKS_END}\nb\n`;
    expect(
      replaceBetweenMarkers(text, TASKS_START, TASKS_END, `${TASKS_START}\nnew\n${TASKS_END}\n`),
    ).toBe(`a\n${TASKS_START}\nnew\n${TASKS_END}\nb\n`);
    expect(replaceBetweenMarkers("no markers\n", TASKS_START, TASKS_END, "x")).toBeNull();
  });
});

describe("migrate", () => {
  test("upgrades v0 epic, tasks, plan table, memo changelog", async () => {
    const root = await makeTempDir("migrate");
    await writeTree(root, {
      "docs/pm/old/epic.md":
        "---\nid: old\ntitle: Old\ntype: bug\nstatus: draft\nowner: x\ncreated: 2026-08-01\nupdated: 2026-08-01\n---\n\n# Old\n",
      "docs/pm/old/plan.md":
        "---\nepic: old\nstatus: draft\nupdated: 2026-08-01\n---\n\n# Plan\n\n## Task breakdown & traceability\n\n| Task | Title | Milestone | Priority | Depends on | Status |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n| T01 | Do it | M1 | must | — | todo |\n\n## Prioritization\n",
      "docs/pm/old/tasks/T01-do-it.md":
        "---\nid: T01\nepic: old\nmilestone: M1\ntitle: Do it\nstatus: todo\npriority: must\ndepends-on: []\nestimate: S\nowner: x\nupdated: 2026-08-01\n---\n\n# T01\n",
      "docs/pm/pmanager-memo.md":
        "# PManager memo\n\n_Last updated: 2026-08-01_\n\n## 5. Changelog\n\nOne line per run, newest first:\n\n- 2026-08-01 — spec'd `old`; learned nothing\n",
    });
    const touched = await migrate(await loadPmRepo(root), "2026-09-15");
    expect(touched.length).toBeGreaterThanOrEqual(4);
    const repo = await loadPmRepo(root);
    const epic = repo.epics[0]?.epic;
    expect(contractVersion(epic?.frontmatter ?? {})).toBe(1);
    expect(getString(epic?.frontmatter ?? {}, "primary-metric")).toBe("unknown");
    expect(epic?.frontmatter.repos).toEqual([]);
    expect(contractVersion(repo.epics[0]?.tasks[0]?.frontmatter ?? {})).toBe(1);
    expect(repo.epics[0]?.plan?.raw).toContain(TASKS_START);
    expect(repo.memo?.raw).toContain(LOG_START);
    expect(repo.logs).toHaveLength(1);
    expect(repo.logs[0]?.message).toBe("spec'd `old`; learned nothing");
    expect(repo.logs[0]?.date).toBe("2026-08-01");
    expect(planRender(repo)).toEqual([]);
  });
  test("memo migration keeps the preamble and sections after the changelog", async () => {
    const root = await makeTempDir("migrate");
    await writeTree(root, {
      "docs/pm/pmanager-memo.md":
        "# PManager memo\n\n_Last updated: 2026-08-01_\n\n## 1. Product context\n\nA shop.\n\n## Changelog\n\nnewest first:\n\n- 2026-08-01 — spec'd `old`\n- 2026-07-01 — first run\n\n## 6. Notes\n\nKeep me.\n",
    });
    await migrate(await loadPmRepo(root), "2026-09-15");
    const memo = await readFile(join(root, "docs/pm/pmanager-memo.md"), "utf8");
    expect(
      memo.startsWith(
        "# PManager memo\n\n_Last updated: 2026-08-01_\n\n## 1. Product context\n\nA shop.\n\n## Changelog\n",
      ),
    ).toBe(true);
    expect(memo).toContain("newest first:\n\n<!-- pm:log:start -->\n");
    expect(memo).toContain("## 6. Notes\n\nKeep me.\n");
    expect(memo).not.toContain("- 2026-08-01 — spec'd");
    const repo = await loadPmRepo(root);
    expect(repo.logs.map((l) => l.date).sort()).toEqual(["2026-07-01", "2026-08-01"]);
    expect(memo).toContain("- 2026-08-01 — `-` · update · spec'd `old`");
  });
  test("memo without a changelog heading keeps all content and gains a section", async () => {
    const root = await makeTempDir("migrate");
    const original =
      "# PManager memo\n\n## 1. Product context\n\nA shop.\n\n## 4. Conventions\n\nNone.\n";
    await writeTree(root, { "docs/pm/pmanager-memo.md": original });
    await migrate(await loadPmRepo(root), "2026-09-15");
    const memo = await readFile(join(root, "docs/pm/pmanager-memo.md"), "utf8");
    expect(memo.startsWith(original.replace(/\n+$/, ""))).toBe(true);
    expect(memo).toContain(
      "## 5. Changelog\n\n<!-- pm:log:start -->\n- none yet\n<!-- pm:log:end -->\n",
    );
  });
  test("is a no-op on a v1 repo", async () => {
    const { repo } = await fixtureRepo();
    expect(await migrate(repo, "2026-09-15")).toEqual([]);
  });
});
