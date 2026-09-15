import { describe, expect, test } from "bun:test";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { check } from "../scripts/check";
import { loadPmRepo } from "../scripts/repo";
import { copyFixture, makeTempDir, writeTree } from "./helpers";

const OPTS = { staleDays: 14, today: "2026-09-15" };

async function fixture() {
  const root = await makeTempDir("check");
  await copyFixture(root);
  return root;
}

async function edit(root: string, rel: string, from: string, to: string) {
  const p = join(root, rel);
  const raw = await readFile(p, "utf8");
  if (!raw.includes(from)) throw new Error(`edit: ${from} not in ${rel}`);
  await Bun.write(p, raw.replace(from, to));
}

async function rules(root: string) {
  return check(await loadPmRepo(root), OPTS).map((f) => f.rule);
}

const T01 = "docs/pm/app-performance/tasks/T01-benchmark-orders.md";
const T02 = "docs/pm/app-performance/tasks/T02-add-order-items-index.md";
const T03 = "docs/pm/app-performance/tasks/T03-batch-item-queries.md";
const T04 = "docs/pm/app-performance/tasks/T04-restore-pagination.md";
const EPIC = "docs/pm/app-performance/epic.md";
const PLAN = "docs/pm/app-performance/plan.md";

describe("clean fixture", () => {
  test("has no findings", async () => {
    const root = await fixture();
    expect(check(await loadPmRepo(root), OPTS)).toEqual([]);
  });
});

describe("structure", () => {
  test("E-STR-001 missing plan.md", async () => {
    const root = await fixture();
    await unlink(join(root, PLAN));
    expect(await rules(root)).toContain("E-STR-001");
  });
  test("E-STR-002 missing required section", async () => {
    const root = await fixture();
    await edit(root, EPIC, "## Non-goals (required)", "## Not goals");
    expect(await rules(root)).toContain("E-STR-002");
  });
  test("E-STR-003 missing field and E-STR-004 bad value", async () => {
    const root = await fixture();
    await edit(root, T04, "estimate: M\n", "");
    await edit(root, T03, "priority: must", "priority: urgent");
    const r = await rules(root);
    expect(r).toContain("E-STR-003");
    expect(r).toContain("E-STR-004");
  });
  test("E-STR-005 unparseable frontmatter", async () => {
    const root = await fixture();
    await edit(root, T04, "estimate: M", "this is not yaml");
    expect(await rules(root)).toContain("E-STR-005");
  });
});

describe("identity and references", () => {
  test("E-ID-001 duplicate epic id", async () => {
    const root = await fixture();
    const epic = await readFile(join(root, EPIC), "utf8");
    await writeTree(root, {
      "docs/pm/copy/epic.md": epic,
      "docs/pm/copy/plan.md":
        "---\nepic: copy\nstatus: draft\nupdated: 2026-09-10\ncontract: 1\n---\n",
    });
    expect(await rules(root)).toContain("E-ID-001");
  });
  test("E-ID-002 duplicate task id, E-ID-003 filename mismatch", async () => {
    const root = await fixture();
    await edit(root, T04, "id: T04", "id: T03");
    const r = await rules(root);
    expect(r).toContain("E-ID-002");
    expect(r).toContain("E-ID-003");
  });
  test("E-REF-001 task epic mismatch", async () => {
    const root = await fixture();
    await edit(root, T01, "epic: app-performance", "epic: other");
    expect(await rules(root)).toContain("E-REF-001");
  });
  test("E-REF-002 unknown milestone", async () => {
    const root = await fixture();
    await edit(root, T01, "milestone: M1", "milestone: M9");
    expect(await rules(root)).toContain("E-REF-002");
  });
  test("E-REF-003 unknown dependency", async () => {
    const root = await fixture();
    await edit(root, T02, "depends-on: [T01]", "depends-on: [T99]");
    expect(await rules(root)).toContain("E-REF-003");
  });
  test("E-REF-004 cycle", async () => {
    const root = await fixture();
    await edit(root, T01, "depends-on: []", "depends-on: [T03]");
    expect(await rules(root)).toContain("E-REF-004");
  });
});

describe("derived views", () => {
  test("E-RND-001 stale index and E-RND-002 stale plan table", async () => {
    const root = await fixture();
    await edit(root, T04, "status: todo", "status: done");
    const r = await rules(root);
    expect(r).toContain("E-RND-001");
    expect(r).toContain("E-RND-002");
  });
  test("E-RND-003 stale memo log", async () => {
    const root = await fixture();
    await writeTree(root, {
      "docs/pm/log/2026-09-11-app-performance-ffffff.md":
        "---\ndate: 2026-09-11\nepic: app-performance\nharness: pi\nkind: update\n---\nT01 done\n",
    });
    expect(await rules(root)).toContain("E-RND-003");
  });
  test("E-RND-004 missing markers in v1 plan", async () => {
    const root = await fixture();
    await edit(root, PLAN, "<!-- pm:tasks:start -->\n", "");
    expect(await rules(root)).toContain("E-RND-004");
  });
  test("E-RND-004 unterminated and misordered marker pairs, plan and memo", async () => {
    const MEMO = "docs/pm/pmanager-memo.md";
    let root = await fixture();
    await edit(root, PLAN, "<!-- pm:tasks:end -->\n", "");
    expect(await rules(root)).toContain("E-RND-004");
    root = await fixture();
    await edit(root, PLAN, "<!-- pm:tasks:start -->", "<!-- pm:tasks:TMP -->");
    await edit(root, PLAN, "<!-- pm:tasks:end -->", "<!-- pm:tasks:start -->");
    await edit(root, PLAN, "<!-- pm:tasks:TMP -->", "<!-- pm:tasks:end -->");
    expect(await rules(root)).toContain("E-RND-004");
    root = await fixture();
    await edit(root, MEMO, "<!-- pm:log:end -->\n", "");
    expect(await rules(root)).toContain("E-RND-004");
    root = await fixture();
    await edit(root, MEMO, "<!-- pm:log:start -->", "<!-- pm:log:TMP -->");
    await edit(root, MEMO, "<!-- pm:log:end -->", "<!-- pm:log:start -->");
    await edit(root, MEMO, "<!-- pm:log:TMP -->", "<!-- pm:log:end -->");
    expect(await rules(root)).toContain("E-RND-004");
  });
  test("findings carry file and fix", async () => {
    const root = await fixture();
    await edit(root, T04, "status: todo", "status: done");
    const f = check(await loadPmRepo(root), OPTS).find((x) => x.rule === "E-RND-001");
    expect(f?.file.endsWith("docs/pm/INDEX.md")).toBe(true);
    expect(f?.fix).toBe("run render");
  });
});

describe("state rules", () => {
  test("E-ST-001 blocked without blocker; clean when Notes filled", async () => {
    const root = await fixture();
    await edit(root, T02, "status: todo", "status: blocked");
    expect(await rules(root)).toContain("E-ST-001");
    await edit(root, T02, "## Notes\n", "## Notes\n\nBlocked on DBA review.\n");
    expect((await rules(root)).filter((r) => r === "E-ST-001")).toEqual([]);
  });
  test("E-ST-002 descoped not in Won't", async () => {
    const root = await fixture();
    await edit(root, T04, "status: todo", "status: descoped");
    expect(await rules(root)).toContain("E-ST-002");
    await edit(
      root,
      PLAN,
      "- Won't (this epic): storage-layer rewrite",
      "- Won't (this epic): T04 restore pagination (client owns paging); storage-layer rewrite",
    );
    expect((await rules(root)).filter((r) => r === "E-ST-002")).toEqual([]);
  });
  test("E-ST-003 done with unchecked criteria; unverified marker clears it", async () => {
    const root = await fixture();
    await edit(root, T01, "status: todo", "status: done");
    expect(await rules(root)).toContain("E-ST-003");
    await edit(
      root,
      T01,
      "## Acceptance criteria\n",
      "## Acceptance criteria\n\n**unverified** — claimed by user, no artifact yet\n",
    );
    expect((await rules(root)).filter((r) => r === "E-ST-003")).toEqual([]);
  });
  test("E-ST-004 epic done without outcome", async () => {
    const root = await fixture();
    await edit(root, EPIC, "status: in-progress", "status: done");
    expect(await rules(root)).toContain("E-ST-004");
  });
});

describe("claim rules", () => {
  test("E-CLM-001 malformed session", async () => {
    const root = await fixture();
    await edit(root, EPIC, "branch: pm/app-performance", "branch: pm/other");
    expect(await rules(root)).toContain("E-CLM-001");
  });
  test("W-CLM-001 stale claim", async () => {
    const root = await fixture();
    const r = check(await loadPmRepo(root), { staleDays: 3, today: "2026-09-30" });
    expect(r.map((f) => f.rule)).toContain("W-CLM-001");
    expect(r.find((f) => f.rule === "W-CLM-001")?.severity).toBe("warning");
  });
  test("W-CLM-002 in-progress without session", async () => {
    const root = await fixture();
    await edit(
      root,
      EPIC,
      "session:\n  harness: claude-code\n  claimed: 2026-09-10\n  branch: pm/app-performance\n",
      "",
    );
    expect(await rules(root)).toContain("W-CLM-002");
  });
});

describe("legacy", () => {
  test("W-LEG-001 for v0 docs, no E-STR-003", async () => {
    const root = await fixture();
    await edit(root, EPIC, "contract: 1\n", "");
    await edit(root, EPIC, "repos:\n  - git@github.com:glapsfun/webshop.git\n", "");
    const r = await rules(root);
    expect(r).toContain("W-LEG-001");
    expect(r).not.toContain("E-STR-003");
  });
});
