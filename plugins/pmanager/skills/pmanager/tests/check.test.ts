import { describe, expect, test } from "bun:test";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { check } from "../scripts/check";
import { type Catalog, type Project, renderProjectsIndex } from "../scripts/projects";
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

describe("dangling first-milestone task (E-REF-005)", () => {
  async function dangling() {
    const root = await fixture();
    await edit(root, T02, "depends-on: [T01]", "depends-on: []");
    return root;
  }
  async function epicRules(root: string, epic?: string) {
    return check(await loadPmRepo(root), { ...OPTS, epic }).filter((f) => f.rule === "E-REF-005");
  }

  test("fires for the epic under work, on the first-milestone task nothing depends on", async () => {
    const f = await epicRules(await dangling(), "app-performance");
    expect(f.map((x) => x.file)).toEqual([expect.stringContaining("T01-benchmark-orders.md")]);
    expect(f[0]?.severity).toBe("error");
    const fix = f[0]?.fix ?? "";
    expect(fix.indexOf("depends-on")).toBeGreaterThanOrEqual(0);
    expect(fix.indexOf("depends-on")).toBeLessThan(fix.indexOf("milestone"));
    expect(fix.indexOf("milestone")).toBeLessThan(fix.indexOf("standalone:"));
  });

  test("plain check and another epic's check never report it", async () => {
    const root = await dangling();
    expect(await epicRules(root)).toEqual([]);
    expect(await epicRules(root, "other")).toEqual([]);
  });

  test("a started epic is exempt: a task in-progress or done", async () => {
    for (const started of ["status: in-progress", "status: done"]) {
      const root = await dangling();
      await edit(root, T04, "status: todo", started);
      expect(await epicRules(root, "app-performance")).toEqual([]);
    }
  });

  test("a task whose History shows it started exempts the epic, even when it is blocked now", async () => {
    const root = await dangling();
    await edit(root, T04, "status: todo", "status: blocked");
    expect(await epicRules(root, "app-performance")).toHaveLength(1);
    const p = join(root, T04);
    await Bun.write(
      p,
      `${await readFile(p, "utf8")}\n## History\n\n- 2026-09-10 status todo -> in-progress\n- 2026-09-12 status in-progress -> blocked\n`,
    );
    expect(await epicRules(root, "app-performance")).toEqual([]);
  });

  test("a standalone reason exempts a first-milestone task; an empty one does not", async () => {
    for (const [value, fires] of [
      ["captures the baseline the later checks compare against", 0],
      ['""', 1],
    ] as const) {
      const root = await dangling();
      await edit(root, T01, "depends-on: []", `depends-on: []\nstandalone: ${value}`);
      expect(await epicRules(root, "app-performance")).toHaveLength(fires);
    }
  });

  test("a descoped first-milestone task is exempt", async () => {
    const root = await dangling();
    await edit(root, T01, "status: todo", "status: descoped");
    expect(await epicRules(root, "app-performance")).toEqual([]);
  });

  test("a plan whose later milestones have no tasks never fires", async () => {
    const root = await dangling();
    await edit(root, T02, "milestone: M2", "milestone: M1");
    await edit(root, T03, "milestone: M2", "milestone: M1");
    await edit(root, T04, "milestone: M3", "milestone: M1");
    expect(await epicRules(root, "app-performance")).toEqual([]);
  });

  test("a descoped dependent does not make a first-milestone task needed", async () => {
    const root = await fixture();
    await edit(root, T02, "status: todo", "status: descoped");
    const f = await epicRules(root, "app-performance");
    expect(f.map((x) => x.file)).toEqual([expect.stringContaining("T01-benchmark-orders.md")]);
  });

  test("a plan with one milestone never fires", async () => {
    const root = await dangling();
    await edit(root, T02, "milestone: M2", "milestone: M1");
    await edit(root, T03, "milestone: M2", "milestone: M1");
    await edit(root, T04, "milestone: M3", "milestone: M1");
    const plan = join(root, PLAN);
    await Bun.write(plan, (await readFile(plan, "utf8")).replace(/^### M[23]\b.*$/gm, ""));
    expect(await epicRules(root, "app-performance")).toEqual([]);
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
  test("E-RND-004 duplicate end markers, plan and memo", async () => {
    const MEMO = "docs/pm/pmanager-memo.md";
    let root = await fixture();
    await edit(
      root,
      PLAN,
      "<!-- pm:tasks:end -->\n",
      "<!-- pm:tasks:end -->\n<!-- pm:tasks:end -->\n",
    );
    expect(await rules(root)).toContain("E-RND-004");
    root = await fixture();
    await edit(root, MEMO, "<!-- pm:log:end -->\n", "<!-- pm:log:end -->\n<!-- pm:log:end -->\n");
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

describe("acceptance rules", () => {
  const PAGED = "- [ ] Default response is at most 50 orders";

  async function vague(root: string) {
    return check(await loadPmRepo(root), OPTS).filter((f) => f.rule === "W-ACC-001");
  }

  test("W-ACC-001 vague task criterion, as a warning naming the line", async () => {
    const root = await fixture();
    await edit(root, T04, PAGED, "- [ ] The orders page feels nicer");
    const found = await vague(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe(join(root, T04));
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("The orders page feels nicer");
  });

  test("W-ACC-001 vague milestone exit criterion", async () => {
    const root = await fixture();
    await edit(root, PLAN, "- [ ] /orders is paginated", "- [ ] Pagination works properly");
    const found = await vague(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe(join(root, PLAN));
  });

  test("a number or code, even on a continuation line, clears W-ACC-001", async () => {
    const root = await fixture();
    await edit(root, T04, PAGED, "- [ ] The orders page feels faster: p95 under 300ms");
    await edit(
      root,
      PLAN,
      "- [ ] /orders is paginated",
      "- [ ] Paging looks good\n  in `pytest tests/test_pages.py`",
    );
    expect(await vague(root)).toEqual([]);
  });

  test("checked boxes, other sections and concrete wording are not flagged", async () => {
    const root = await fixture();
    await edit(
      root,
      T04,
      PAGED,
      "- [x] The orders page feels nicer\n- [ ] Commas are escaped correctly",
    );
    await edit(root, T04, "## Out of scope", "## Out of scope\n\n- [ ] A nicer empty state");
    expect(await vague(root)).toEqual([]);
  });
});

describe("history rules", () => {
  async function history(root: string, rel: string, lines: string[]) {
    const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    await edit(root, rel, "## Notes\n", `## Notes\n\n## History\n\n${body}`);
  }

  async function his(root: string, rule: string) {
    return check(await loadPmRepo(root), OPTS).filter((f) => f.rule === rule);
  }

  test("E-HIS-001 names each line in neither form, as an error", async () => {
    const root = await fixture();
    await history(root, T01, ["- 2026-09-15 started work"]);
    const f = await his(root, "E-HIS-001");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("error");
    expect(f[0]?.file).toBe(join(root, T01));
    expect(f[0]?.message).toContain("started work");
  });

  test("valid History matching frontmatter raises nothing", async () => {
    const root = await fixture();
    await edit(root, T01, "status: todo", "status: in-progress");
    await history(root, T01, [
      "- 2026-09-15 status todo -> in-progress",
      "- 2026-09-15 attempt failed: tried one insert per commit; got database is locked; evidence docs/attempt-1.log",
    ]);
    expect((await rules(root)).filter((r) => r.includes("HIS"))).toEqual([]);
  });

  test("W-HIS-002 warns when the last status line disagrees with frontmatter", async () => {
    const root = await fixture();
    await history(root, T01, ["- 2026-09-15 status todo -> in-progress"]);
    const f = await his(root, "W-HIS-002");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warning");
    expect(f[0]?.message).toContain("in-progress");
  });

  test("E-HIS-001 fix text names the optional fixed by suffix", async () => {
    const root = await fixture();
    await history(root, T01, ["- 2026-09-15 started work"]);
    const f = await his(root, "E-HIS-001");
    expect(f[0]?.fix).toContain('"- YYYY-MM-DD status <from> -> <to>[; fixed by <what>]"');
  });

  test("an invalid History line suppresses W-HIS-002", async () => {
    const root = await fixture();
    await edit(root, T01, "status: todo", "status: done");
    await history(root, T01, [
      "- 2026-09-15 status todo -> in-progress",
      "- 2026-09-15 status in-progress -> done (fixed by one transaction)",
    ]);
    expect(await his(root, "E-HIS-001")).toHaveLength(1);
    expect(await his(root, "W-HIS-002")).toEqual([]);
  });

  test("an unknown or missing frontmatter status leaves W-HIS-002 to the field rules", async () => {
    const unknown = await fixture();
    await edit(unknown, T01, "status: todo", "status: started");
    await history(unknown, T01, ["- 2026-09-15 status todo -> in-progress"]);
    expect(await rules(unknown)).toContain("E-STR-004");
    expect(await his(unknown, "W-HIS-002")).toEqual([]);
    const missing = await fixture();
    await edit(missing, T01, "status: todo\n", "");
    await history(missing, T01, ["- 2026-09-15 status todo -> in-progress"]);
    expect(await rules(missing)).toContain("E-STR-003");
    expect(await his(missing, "W-HIS-002")).toEqual([]);
  });

  test("W-HIS-002 reads only the last of several status lines", async () => {
    const agrees = await fixture();
    await edit(agrees, T01, "status: todo", "status: done");
    await history(agrees, T01, [
      "- 2026-09-15 status todo -> in-progress",
      "- 2026-09-15 status in-progress -> done",
    ]);
    expect(await his(agrees, "W-HIS-002")).toEqual([]);
    const lags = await fixture();
    await edit(lags, T01, "status: todo", "status: done");
    await history(lags, T01, [
      "- 2026-09-15 status todo -> in-progress",
      "- 2026-09-15 status in-progress -> blocked",
    ]);
    const f = await his(lags, "W-HIS-002");
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('"blocked"');
  });

  test("attempt-only or empty History raises no W-HIS-002", async () => {
    const root = await fixture();
    await history(root, T01, [
      "- 2026-09-15 attempt failed: tried one insert per commit; got database is locked; evidence docs/attempt-1.log",
    ]);
    await history(root, T02, []);
    expect((await rules(root)).filter((r) => r.includes("HIS"))).toEqual([]);
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

describe("project catalog", () => {
  const project = (id: string, url: string) => ({
    id,
    name: id,
    url,
    added: "2026-09-01",
    file: `/m/docs/pm/projects/${id}.md`,
  });
  async function findings(projects: Project[], extra: Partial<Catalog> = {}, epicStatus?: string) {
    const root = await fixture();
    if (epicStatus) await edit(root, EPIC, "status: in-progress", `status: ${epicStatus}`);
    const catalog = { projects, invalid: [], index: renderProjectsIndex(projects), ...extra };
    return check(await loadPmRepo(root), { ...OPTS, catalog });
  }
  const only = (fs: Awaited<ReturnType<typeof findings>>, rule: string) =>
    fs.filter((f) => f.rule === rule);

  test("an active epic naming an unregistered repo warns W-PRJ-001", async () => {
    const fs = only(
      await findings([project("infra", "https://github.com/acme/infra.git")]),
      "W-PRJ-001",
    );
    expect(fs).toHaveLength(1);
    expect(fs[0]?.severity).toBe("warning");
    expect(fs[0]?.message).toContain("git@github.com:glapsfun/webshop.git");
    expect(fs[0]?.fix).toContain("pm project add git@github.com:glapsfun/webshop.git");
  });

  test("another URL form, a done or abandoned epic, or an empty catalog give no W-PRJ-001", async () => {
    const webshop = project("webshop", "https://github.com/glapsfun/webshop");
    expect(only(await findings([webshop]), "W-PRJ-001")).toEqual([]);
    const infra = project("infra", "https://github.com/acme/infra.git");
    expect(only(await findings([infra], {}, "done"), "W-PRJ-001")).toEqual([]);
    expect(only(await findings([infra], {}, "abandoned"), "W-PRJ-001")).toEqual([]);
    expect(only(await findings([]), "W-PRJ-001")).toEqual([]);
  });

  test("checked for one epic, the catalog only adds W-PRJ-001", async () => {
    const root = await fixture();
    const infra = project("infra", "https://github.com/acme/infra.git");
    const invalid = [{ file: "/m/docs/pm/projects/README.md", reason: "missing id, name, url" }];
    const catalog = { projects: [infra], invalid, index: "stale\n" };
    const fs = check(await loadPmRepo(root), { ...OPTS, catalog, catalogScope: "epic" });
    expect(fs.filter((f) => f.rule.includes("PRJ")).map((f) => f.rule)).toEqual(["W-PRJ-001"]);
  });

  test("broken or duplicate project files are E-PRJ-001; a stale index is W-PRJ-002", async () => {
    const infra = project("infra", "https://github.com/acme/infra.git");
    const broken = await findings([infra], {
      invalid: [{ file: "/m/docs/pm/projects/bad.md", reason: "missing url" }],
    });
    expect(only(broken, "E-PRJ-001").map((f) => f.message)).toEqual(["missing url"]);
    const dup = await findings([infra, project("infra2", "git@github.com:acme/infra.git")]);
    expect(only(dup, "E-PRJ-001")).toHaveLength(1);
    expect(only(await findings([infra], { index: "stale\n" }), "W-PRJ-002")).toHaveLength(1);
    expect(only(await findings([infra]), "W-PRJ-002")).toEqual([]);
  });
});
