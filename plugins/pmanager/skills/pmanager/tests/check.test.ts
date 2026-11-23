import { describe, expect, test } from "bun:test";
import { cp, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type CheckOptions, check } from "../scripts/check";
import { extractProfile, PROFILE_FORMAT, type Profile } from "../scripts/profile";
import { type Catalog, type Project, renderProjectsIndex } from "../scripts/projects";
import { loadPmRepo } from "../scripts/repo";
import { copyFixture, gitOk, initGitRepo, makeTempDir, writeTree } from "./helpers";

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

const ORDERS_URL = "https://github.com/pm-example/orders.git";
const ORDERS_DIR = join(import.meta.dir, "../../../../../bench/scenarios/fixtures/orders");
const TASKS = [T01, T02, T03, T04];
let ordersProfile: Promise<Profile> | null = null;

function profileOfOrders(): Promise<Profile> {
  ordersProfile ??= (async () => {
    const dir = await makeTempDir("check-orders");
    await cp(ORDERS_DIR, dir, { recursive: true });
    await initGitRepo(dir);
    await gitOk(["add", "-A"], dir);
    await gitOk(["commit", "-q", "-m", "seed"], dir);
    return extractProfile(dir);
  })();
  return ordersProfile;
}

const CATALOG: Catalog = {
  projects: [{ id: "orders", name: "orders", url: ORDERS_URL, added: "2026-09-01", file: "" }],
  invalid: [],
  index: null,
};

/** The fixture epic planned against orders, every task naming no parts unless set. */
async function partFixture(): Promise<string> {
  const root = await fixture();
  await edit(root, EPIC, "  - git@github.com:glapsfun/webshop.git", `  - ${ORDERS_URL}`);
  for (const t of TASKS) await edit(root, t, "\ndepends-on:", "\nparts: []\ndepends-on:");
  return root;
}

/** Sets a task's parts and appends text to its Notes. */
async function setTask(root: string, task: string, parts: string, notes = "") {
  await edit(root, task, "parts: []", `parts: ${parts}`);
  if (notes)
    await Bun.write(join(root, task), `${await readFile(join(root, task), "utf8")}\n${notes}\n`);
}

async function partRules(root: string, opts: Partial<CheckOptions> = {}) {
  const profiles = new Map([["orders", await profileOfOrders()]]);
  return check(await loadPmRepo(root), {
    ...OPTS,
    epic: "app-performance",
    catalog: CATALOG,
    profiles,
    ...opts,
  }).filter((f) => /^E-(PRT|REL)-/.test(f.rule));
}
const ids = (fs: { rule: string; file: string }[]) =>
  fs.map((f) => `${f.rule} ${f.file.split("/").pop()}`);

describe("parts and release links (E-PRT, E-REL)", () => {
  test("E-PRT-001: a task with no parts field; parts: [] passes every rule", async () => {
    const root = await partFixture();
    expect(await partRules(root)).toEqual([]);
    await edit(root, T01, "parts: []\n", "");
    expect(ids(await partRules(root))).toEqual(["E-PRT-001 T01-benchmark-orders.md"]);
  });

  test("E-PRT-002: a folder that is no part, and an unknown repo", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders/cmd]");
    expect(ids(await partRules(root))).toEqual(["E-PRT-002 T01-benchmark-orders.md"]);
    const repo = await partFixture();
    await setTask(repo, T01, "[ordrs]");
    expect(ids(await partRules(repo))).toEqual(["E-PRT-002 T01-benchmark-orders.md"]);
  });

  test("E-PRT-003: a part named with none of its checks", async () => {
    const lint = await partFixture();
    await setTask(lint, T01, "[orders/deploy/chart]", "`helm lint deploy/chart` passes");
    expect(ids(await partRules(lint))).toEqual(["E-PRT-003 T01-benchmark-orders.md"]);
    const unit = await partFixture();
    await setTask(unit, T01, "[orders/deploy/chart]", "`helm unittest deploy/chart` passes");
    expect(await partRules(unit)).toEqual([]);
    const plan = await partFixture();
    await setTask(plan, T01, "[orders/infra/terraform]", "run `terraform plan` and review it");
    expect(ids(await partRules(plan))).toEqual(["E-PRT-003 T01-benchmark-orders.md"]);
  });

  test("E-REL-001: the service changes and no task names its release", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`make test` passes");
    expect(ids(await partRules(root))).toEqual(["E-REL-001 epic.md", "E-REL-002 epic.md"]);
  });

  test("E-REL-002: the chart's tag must move after the release", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`make test` passes");
    await setTask(root, T02, "[orders]", "run `make release`; `make test` passes");
    await setTask(
      root,
      T04,
      "[orders/deploy/chart]",
      "set image.tag; `helm unittest deploy/chart` passes",
    );
    expect(ids(await partRules(root))).toEqual(["E-REL-002 epic.md"]);
    await edit(root, T04, "depends-on: []", "depends-on: [T02]");
    expect(await partRules(root)).toEqual([]);
    const one = await partFixture();
    await setTask(
      one,
      T01,
      "[orders, orders/deploy/chart]",
      "run `make release`, then set image.tag; `make test` and `helm unittest deploy/chart` pass",
    );
    expect(await partRules(one)).toEqual([]);
  });

  test("no-release on the epic turns the release rules off", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`make test` passes");
    await edit(
      root,
      EPIC,
      "primary-metric:",
      "no-release: a refactor, nothing ships\nprimary-metric:",
    );
    expect(await partRules(root)).toEqual([]);
  });

  test("silent for a started epic, plain check, another epic, and repos without a profile", async () => {
    const root = await partFixture();
    await edit(root, T01, "parts: []\n", "");
    expect(await partRules(root, { epic: undefined })).toEqual([]);
    expect(await partRules(root, { epic: "other" })).toEqual([]);
    expect(await partRules(root, { profiles: new Map() })).toEqual([]);
    await edit(root, T04, "status: todo", "status: in-progress");
    expect(await partRules(root)).toEqual([]);
  });
});

describe("fewer fix rounds, from component-profiles-paired", () => {
  test("E-PRT-003: a release task after the part's checked work names its release command, not a check", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`make test` passes");
    await setTask(root, T02, "[orders]", "bump `VERSION` in the Makefile and run `make release`");
    expect(ids(await partRules(root))).toEqual(["E-REL-002 epic.md"]);
  });

  test("E-PRT-003: a task that changes code still names a check when it also releases", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "add the export handler, then run `make release`");
    expect(ids(await partRules(root))).toEqual([
      "E-REL-002 epic.md",
      "E-PRT-003 T01-benchmark-orders.md",
    ]);
  });

  test("E-PRT-003: the release command counts only verbatim", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`make test` passes");
    await setTask(root, T02, "[orders]", "make the export ready for the next release");
    expect(ids(await partRules(root))).toContain("E-PRT-003 T02-add-order-items-index.md");
  });

  test("E-PRT-003: another part's release command is not this part's check", async () => {
    const root = await partFixture();
    await setTask(
      root,
      T04,
      "[orders/deploy/chart]",
      "set image.tag to what `make release` pushed",
    );
    expect(ids(await partRules(root))).toEqual(["E-PRT-003 T04-restore-pagination.md"]);
  });

  test("E-PRT-003: the commands a Makefile target runs count as the target", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`go test ./...` and `go vet ./...` pass");
    expect(ids(await partRules(root))).toEqual(["E-REL-001 epic.md", "E-REL-002 epic.md"]);
  });
});

describe("a repo id with no root part", () => {
  test("means the whole repo: its shared checks apply", async () => {
    const base = await profileOfOrders();
    const shared: Profile["shared"] = [
      { text: "tflint --recursive", role: "check", source: "AGENTS.md:1" },
    ];
    const noRoot = { ...base, parts: base.parts.filter((p) => p.folder !== ""), shared };
    const profiles = new Map([["orders", noRoot]]);
    const missing = await partFixture();
    await setTask(missing, T01, "[orders]", "add envs/staging");
    expect(ids(await partRules(missing, { profiles }))).toEqual([
      "E-PRT-003 T01-benchmark-orders.md",
    ]);
    const named = await partFixture();
    await setTask(named, T01, "[orders]", "`tflint --recursive` passes");
    expect(await partRules(named, { profiles })).toEqual([]);
  });
});

describe("final review: rules", () => {
  test("I4: a profile with no parts and no shared commands asks nothing", async () => {
    const root = await partFixture();
    await edit(root, T01, "parts: []\n", "");
    const empty: Profile = {
      revision: "r",
      parts: [],
      links: [],
      notes: [],
      shared: [],
      releases: [],
      tagSettings: [],
    };
    expect(await partRules(root, { profiles: new Map([["orders", empty]]) })).toEqual([]);
  });

  test("I8 and I1: hints offer the bare repo id and stay short on a big profile", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders/nope]");
    const many: Profile = {
      revision: "r",
      parts: Array.from({ length: 40 }, (_, i) => ({
        folder: `svc${i}`,
        stacks: ["go"],
        commands: [],
      })),
      links: [],
      notes: [],
      shared: [{ text: "tflint --recursive", role: "check", source: "AGENTS.md:1" }],
      releases: [],
      tagSettings: [],
    };
    const [f] = await partRules(root, { profiles: new Map([["orders", many]]) });
    expect(f?.rule).toBe("E-PRT-002");
    expect(f?.fix).toContain("orders (whole repo)");
    expect(f?.fix).toContain("more");
    expect(f?.fix.length ?? 0).toBeLessThan(400);
  });
});

const SF_URL = "https://github.com/pm-example/storefront.git";
const ARGO_URL = "https://github.com/pm-example/argocd.git";
const CROSS_CATALOG: Catalog = {
  projects: [
    { id: "storefront", name: "storefront", url: SF_URL, added: "2026-11-16", file: "" },
    { id: "argocd", name: "argocd", url: ARGO_URL, added: "2026-11-16", file: "" },
  ],
  invalid: [],
  index: null,
};
const empty = { links: [], notes: [], shared: [], releases: [], tagSettings: [] };
const sfProfile = (kind: "tag" | "branch" = "tag"): Profile => ({
  ...empty,
  revision: "r",
  format: PROFILE_FORMAT,
  parts: [
    {
      folder: "",
      stacks: ["node"],
      commands: [{ text: "npm test", role: "check", source: "README.md:9" }],
    },
  ],
  releases: [
    {
      image: "ghcr.io/pm-example/storefront",
      trigger: { kind, pattern: kind === "tag" ? "v*" : "main" },
      context: "",
      folder: "",
      source: ".github/workflows/release.yml:12",
    },
  ],
});
const argoProfile = (folders = ["workloads/storefront"]): Profile => ({
  ...empty,
  revision: "r",
  format: PROFILE_FORMAT,
  parts: folders.map((folder) => ({ folder, stacks: ["kustomize"], commands: [] })),
  tagSettings: folders.map((folder) => ({
    image: "ghcr.io/pm-example/storefront",
    key: "newTag",
    folder,
    file: `${folder}/kustomization.yaml`,
    line: 6,
    value: "2.3.0",
  })),
});

/** The fixture epic planned against storefront and argocd, the repo that rolls it out. */
async function crossFixture(): Promise<string> {
  const root = await fixture();
  await edit(
    root,
    EPIC,
    "  - git@github.com:glapsfun/webshop.git",
    `  - ${SF_URL}\n  - ${ARGO_URL}`,
  );
  for (const t of TASKS) await edit(root, t, "\ndepends-on:", "\nparts: []\ndepends-on:");
  return root;
}

async function crossRules(
  root: string,
  sf = sfProfile(),
  argo = argoProfile(),
  opts: Partial<CheckOptions> = {},
) {
  return check(await loadPmRepo(root), {
    ...OPTS,
    epic: "app-performance",
    catalog: CROSS_CATALOG,
    profiles: new Map([
      ["storefront", sf],
      ["argocd", argo],
    ]),
    ...opts,
  }).filter((f) => /^E-(PRT|REL|DEP)-/.test(f.rule));
}

describe("releases that ship through another repo (E-REL across repos)", () => {
  test("a changed service needs its tag push, then a rollout task in the GitOps repo after it", async () => {
    const root = await crossFixture();
    await setTask(root, T01, "[storefront]", "`npm test` passes");
    const first = await crossRules(root);
    expect(ids(first)).toEqual(["E-REL-001 epic.md", "E-REL-002 epic.md"]);
    expect(first[1]?.message).toContain("argocd/workloads/storefront");
    await setTask(
      root,
      T02,
      "[storefront]",
      "Push a v2.3.1 tag; the release workflow pushes the image.",
    );
    expect(ids(await crossRules(root))).toEqual(["E-REL-002 epic.md"]);
    await setTask(
      root,
      T04,
      "[argocd/workloads/storefront]",
      "Set newTag to 2.3.1 in workloads/storefront/kustomization.yaml.",
    );
    expect(ids(await crossRules(root))).toEqual(["E-REL-002 epic.md"]);
    await edit(root, T04, "depends-on: []", "depends-on: [T02]");
    expect(await crossRules(root)).toEqual([]);
  });

  test("a branch-triggered release needs no release task; the rollout waits for the change", async () => {
    const root = await crossFixture();
    await setTask(root, T01, "[storefront]", "`npm test` passes");
    expect(ids(await crossRules(root, sfProfile("branch")))).toEqual(["E-REL-002 epic.md"]);
    await setTask(
      root,
      T04,
      "[argocd/workloads/storefront]",
      "Set newTag in workloads/storefront/kustomization.yaml.",
    );
    await edit(root, T04, "depends-on: []", "depends-on: [T01]");
    expect(await crossRules(root, sfProfile("branch"))).toEqual([]);
  });

  test("several places set the tag: one rollout task is enough", async () => {
    const root = await crossFixture();
    await setTask(root, T01, "[storefront]", "`npm test` passes");
    await setTask(root, T02, "[storefront]", "Push a v2.3.1 tag.");
    await setTask(
      root,
      T04,
      "[argocd/overlays/staging]",
      "Set newTag in overlays/staging/kustomization.yaml.",
    );
    await edit(root, T04, "depends-on: []", "depends-on: [T02]");
    expect(
      await crossRules(root, sfProfile(), argoProfile(["overlays/staging", "overlays/prod"])),
    ).toEqual([]);
  });

  test("no-release: silences the cross-repo release rules", async () => {
    const root = await crossFixture();
    await setTask(root, T01, "[storefront]", "`npm test` passes");
    await edit(root, EPIC, "\nrepos:", "\nno-release: a docs-only change\nrepos:");
    expect(await crossRules(root)).toEqual([]);
  });
});

const ORDERS_PROFILE: Profile = {
  ...empty,
  revision: "r",
  format: PROFILE_FORMAT,
  parts: [
    {
      folder: "",
      stacks: ["go"],
      commands: [{ text: "go test ./...", role: "check", source: "Makefile:3" }],
    },
  ],
};
const PAY_URL = "https://github.com/pm-example/payments.git";
const BREAK_CATALOG: Catalog = {
  ...CROSS_CATALOG,
  projects: [
    ...CROSS_CATALOG.projects,
    { id: "orders", name: "orders", url: ORDERS_URL, added: "2026-11-16", file: "" },
    { id: "payments", name: "payments", url: PAY_URL, added: "2026-11-16", file: "" },
  ],
};
const TASKS_DIR = "docs/pm/app-performance/tasks";

async function setLine(root: string, rel: string, key: string, value: string) {
  const p = join(root, rel);
  const raw = await readFile(p, "utf8");
  const re = new RegExp(`^${key}: .*$`, "m");
  if (!re.test(raw)) throw new Error(`setLine: no ${key} in ${rel}`);
  await Bun.write(p, raw.replace(re, `${key}: ${value}`));
}

/**
 * Orders (T03) removes what storefront reads. Storefront changes (T01), releases on a v* tag
 * (T02, after T01) and rolls out through argocd's newTag (T04, after T02); T03 waits on the
 * release only, which E-BRK-001 must catch.
 */
async function breakFixture(): Promise<string> {
  const root = await crossFixture();
  await edit(root, EPIC, `  - ${ARGO_URL}`, `  - ${ARGO_URL}\n  - ${ORDERS_URL}`);
  await setTask(root, T01, "[storefront]", "`npm test` passes");
  await setTask(
    root,
    T02,
    "[storefront]",
    "Push a v2.3.1 tag; the release workflow pushes the image.",
  );
  await setTask(root, T03, "[orders]", "Remove `total_cents`; `go test ./...` passes.");
  await edit(root, T03, "\nparts:", "\nbreaks: [storefront]\nparts:");
  await setTask(
    root,
    T04,
    "[argocd/workloads/storefront]",
    "Set newTag to 2.3.1 in workloads/storefront/kustomization.yaml.",
  );
  await setLine(root, T04, "depends-on", "[T02]");
  return root;
}

async function breakRules(root: string, opts: Partial<CheckOptions> = {}, sf = sfProfile()) {
  return check(await loadPmRepo(root), {
    ...OPTS,
    epic: "app-performance",
    catalog: BREAK_CATALOG,
    profiles: new Map([
      ["storefront", sf],
      ["argocd", argoProfile()],
      ["orders", ORDERS_PROFILE],
      ["payments", ORDERS_PROFILE],
    ]),
    ...opts,
  }).filter((f) => /^E-(PRT|REL|BRK)-/.test(f.rule));
}

const brk = <T extends { rule: string }>(fs: T[]) => fs.filter((f) => f.rule.startsWith("E-BRK-"));

/** A task copied from T04's skeleton, with its own id, parts, depends-on and notes. */
async function addTask(root: string, id: string, parts: string, notes: string, deps: string) {
  const raw = await readFile(join(root, T04), "utf8");
  const skeleton = raw.slice(0, raw.indexOf("## Notes") + "## Notes".length);
  const text = skeleton
    .replace(/^id: T04$/m, `id: ${id}`)
    .replace(/^title: .*$/m, `title: Extra ${id}`)
    .replace(/^# T04\b.*$/m, `# ${id} Extra`)
    .replace(/^parts: .*$/m, `parts: ${parts}`)
    .replace(/^depends-on: .*$/m, `depends-on: ${deps}`);
  await Bun.write(join(root, TASKS_DIR, `${id}-extra.md`), `${text}\n\n${notes}\n`);
}

const T03_FILE = "E-BRK-001 T03-batch-item-queries.md";

describe("breaking changes wait for the consumer's rollout (E-BRK)", () => {
  test("the base plan's only finding: T03 waits on the release, not the rollout", async () => {
    const f = await breakRules(await breakFixture());
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain(
      "T03 breaks storefront and does not wait for its rollout (T04 sets newTag in argocd/workloads/storefront)",
    );
    expect(f[0]?.fix).toBe("add T04 to T03's depends-on");
  });

  test("waiting on the rollout passes", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "depends-on", "[T04]");
    expect(await breakRules(root)).toEqual([]);
  });

  test("a plan with no breaks: gets no E-BRK finding", async () => {
    const root = await breakFixture();
    await edit(root, T03, "breaks: [storefront]\n", "");
    expect(await breakRules(root)).toEqual([]);
  });

  test("no task changes the consumer before the break", async () => {
    const root = await breakFixture();
    for (const t of [T01, T02, T04]) await setLine(root, t, "parts", "[]");
    const f = await breakRules(root);
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain(
      "T03 breaks storefront, and no task changes storefront before it",
    );
  });

  test("a storefront task after the break is a follow-up, not required", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "depends-on", "[T04]");
    await addTask(root, "T05", "[storefront]", "Drop the fallback; `npm test` passes.", "[T03]");
    await addTask(root, "T06", "[storefront]", "Push a v2.3.2 tag.", "[T05]");
    await addTask(
      root,
      "T07",
      "[argocd/workloads/storefront]",
      "Set newTag to 2.3.2 in workloads/storefront/kustomization.yaml.",
      "[T06]",
    );
    expect(await breakRules(root)).toEqual([]);
  });

  test("a newTag bump before the consumer's change is not its rollout", async () => {
    const root = await breakFixture();
    await setLine(root, T04, "depends-on", "[]");
    await setLine(root, T03, "depends-on", "[T04]");
    const f = brk(await breakRules(root));
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain("no rollout task after its release");
  });

  test("no rollout task yet points at E-REL", async () => {
    const root = await breakFixture();
    await setLine(root, T04, "parts", "[]");
    const all = await breakRules(root);
    expect(ids(all)).toContain("E-REL-002 epic.md");
    expect(ids(all)).toContain(T03_FILE);
    const f = all.find((x) => x.rule === "E-BRK-001");
    expect(f?.message).toContain(
      "T03 breaks storefront, and storefront's change has no rollout task after its release yet",
    );
    expect(f?.fix).toContain("E-REL-001 and E-REL-002");
  });

  test("a branch-triggered release: the rollout after the change counts", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "depends-on", "[T04]");
    expect(brk(await breakRules(root, {}, sfProfile("branch")))).toEqual([]);
    await setLine(root, T03, "depends-on", "[T01]");
    const f = brk(await breakRules(root, {}, sfProfile("branch")));
    expect(ids(f)).toEqual([T03_FILE]);
  });

  test("a branch-triggered rollout that follows only one change before the break does not count", async () => {
    const root = await breakFixture();
    await setLine(root, T04, "depends-on", "[T01]");
    await setLine(root, T03, "depends-on", "[T04]");
    const f = brk(await breakRules(root, {}, sfProfile("branch")));
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain("no rollout task after its release");
  });

  test("a rollout that comes only after the break is named, not required", async () => {
    const root = await breakFixture();
    await addTask(root, "T05", "[orders]", "Ship the removal; `go test ./...` passes.", "[T03]");
    await setLine(root, T04, "depends-on", "[T02, T05]");
    const f = brk(await breakRules(root));
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain(
      "T03 breaks storefront, and storefront's rollout (T04) comes only after T03",
    );
    expect(f[0]?.fix).toBe("remove T04's depends-on path to T03, then add T04 to T03's depends-on");
  });

  test("a breaking task in the consumer's rollout folder is the consumer's own", async () => {
    const root = await breakFixture();
    for (const t of [T01, T02]) await setLine(root, t, "parts", "[]");
    await setLine(root, T03, "depends-on", "[T04]");
    await edit(root, T04, "\nparts:", "\nbreaks: [storefront]\nparts:");
    const f = brk(await breakRules(root)).filter((x) =>
      x.file.endsWith("T04-restore-pagination.md"),
    );
    expect(f.map((x) => x.rule)).toEqual(["E-BRK-002"]);
    expect(f[0]?.message).toContain("T04 breaks storefront, its own repo");
  });

  test("no-release on the epic: waiting on the change tasks is enough", async () => {
    const root = await breakFixture();
    await edit(root, EPIC, "\nrepos:", "\nno-release: a docs-only change\nrepos:");
    await setLine(root, T04, "parts", "[]");
    expect(await breakRules(root)).toEqual([]);
    await setLine(root, T03, "depends-on", "[]");
    const f = await breakRules(root);
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain("T03 breaks storefront and does not wait for T01, T02");
    expect(f[0]?.fix).toBe("add T01, T02 to T03's depends-on");
  });

  test("config in the repo that rolls the consumer out counts as the consumer's", async () => {
    const root = await breakFixture();
    for (const t of [T01, T02]) await setLine(root, t, "parts", "[]");
    await edit(
      root,
      T04,
      "Set newTag to 2.3.1 in workloads/storefront/kustomization.yaml.",
      "Set ASSETS_BUCKET in workloads/storefront/deployment.yaml.",
    );
    await setLine(root, T04, "depends-on", "[]");
    await setLine(root, T03, "depends-on", "[]");
    const f = await breakRules(root);
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.message).toContain("T03 breaks storefront and does not wait for T04");
    await setLine(root, T03, "depends-on", "[T04]");
    expect(await breakRules(root)).toEqual([]);
  });

  test("breaks: [argocd] waits on argocd's tasks", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "breaks", "[argocd]");
    await setLine(root, T03, "depends-on", "[]");
    const f = await breakRules(root);
    expect(ids(f)).toEqual([T03_FILE]);
    expect(f[0]?.fix).toBe("add T04 to T03's depends-on");
  });

  test("E-BRK-002: unknown id, a repo the epic does not list, the task's own repo", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "breaks", "[nosuch]");
    const [unknown] = await breakRules(root);
    expect(unknown?.rule).toBe("E-BRK-002");
    expect(unknown?.message).toContain("nosuch");
    for (const id of ["storefront", "argocd", "orders"]) expect(unknown?.fix).toContain(id);
    await setLine(root, T03, "breaks", "[payments]");
    const [unlisted] = await breakRules(root);
    expect(unlisted?.rule).toBe("E-BRK-002");
    expect(unlisted?.fix).toBe(`add ${PAY_URL} to repos: in epic.md`);
    await setLine(root, T03, "breaks", "[orders]");
    const [own] = await breakRules(root);
    expect(own?.rule).toBe("E-BRK-002");
    expect(own?.message).toContain("its own repo");
  });

  test("a part id in breaks: gets the project ids", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "breaks", "[argocd/workloads/storefront]");
    const f = await breakRules(root);
    expect(f.map((x) => x.rule)).toEqual(["E-BRK-002"]);
    expect(f[0]?.fix).toContain("argocd");
  });

  test("a repeated id reports once", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "breaks", "[storefront, storefront]");
    expect(ids(await breakRules(root))).toEqual([T03_FILE]);
  });

  test("one finding per broken repo", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "breaks", "[storefront, argocd]");
    await setLine(root, T03, "depends-on", "[]");
    expect(ids(await breakRules(root))).toEqual([T03_FILE, T03_FILE]);
  });

  test("a scalar breaks: reads as one id", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "breaks", "storefront");
    expect(ids(await breakRules(root))).toEqual([T03_FILE]);
  });

  test("a descoped breaking task is not checked", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "status", "descoped");
    expect(brk(await breakRules(root))).toEqual([]);
  });

  test("a descoped rollout does not count", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "depends-on", "[T04]");
    await setLine(root, T04, "status", "descoped");
    const f = brk(await breakRules(root));
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("no rollout task after its release");
  });

  test("a cycle through the break terminates", async () => {
    const root = await breakFixture();
    await setLine(root, T03, "depends-on", "[T04]");
    await setLine(root, T01, "depends-on", "[T03]");
    expect(ids(brk(await breakRules(root)))).toEqual([T03_FILE]);
    const all = check(await loadPmRepo(root), {
      ...OPTS,
      epic: "app-performance",
      catalog: BREAK_CATALOG,
      profiles: new Map([
        ["storefront", sfProfile()],
        ["argocd", argoProfile()],
        ["orders", ORDERS_PROFILE],
      ]),
    });
    expect(all.map((x) => x.rule)).toContain("E-REF-004");
  });

  test("silent for a started epic, plain check, another epic, and no profiles", async () => {
    const root = await breakFixture();
    expect(brk(await breakRules(root, { epic: undefined }))).toEqual([]);
    expect(brk(await breakRules(root, { epic: "other" }))).toEqual([]);
    expect(brk(await breakRules(root, { profiles: new Map() }))).toEqual([]);
    await setLine(root, T04, "status", "in-progress");
    expect(brk(await breakRules(root))).toEqual([]);
  });
});

const XNET = (project: string, version: string, line = 7) => ({
  project,
  name: "golang.org/x/net",
  version,
  ecosystem: "go" as const,
  file: "go.mod",
  line,
  direct: false,
  via: null,
});

describe("other repos that carry a bumped package (E-DEP-001)", () => {
  const depRules = async (root: string, carriers: Map<string, ReturnType<typeof XNET>[]>) =>
    (await partRules(root, { carriers }))
      .concat(
        check(await loadPmRepo(root), {
          ...OPTS,
          epic: "app-performance",
          catalog: CATALOG,
          carriers,
        }).filter((f) => f.rule === "E-DEP-001"),
      )
      .filter((f) => f.rule === "E-DEP-001");

  test("a bump in orders flags webshop still on an older version", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "Run go get golang.org/x/net@v0.36.0; `make test` passes");
    const carriers = new Map([
      ["golang.org/x/net", [XNET("orders", "v0.17.0", 5), XNET("webshop", "v0.23.0")]],
    ]);
    const found = await depRules(root, carriers);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("webshop");
    expect(found[0]?.message).toContain("go.mod:7");
    expect(found[0]?.message).toContain("v0.23.0");
  });

  test("silent when webshop has a task, is current, is skipped, is unavailable, or the target does not compare", async () => {
    const at = (version: string) => new Map([["golang.org/x/net", [XNET("webshop", version)]]]);
    const covered = await partFixture();
    await setTask(
      covered,
      T01,
      "[orders]",
      "Run go get golang.org/x/net@v0.36.0; `make test` passes",
    );
    await setTask(covered, T02, "[webshop]", "Run go get golang.org/x/net@v0.36.0.");
    expect(await depRules(covered, at("v0.23.0"))).toEqual([]);
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "Run go get golang.org/x/net@v0.36.0; `make test` passes");
    expect(await depRules(root, at("v0.36.0"))).toEqual([]);
    expect(await depRules(root, new Map())).toEqual([]);
    await edit(root, EPIC, "\nrepos:", '\ndep-skip:\n  - "webshop: not deployed"\nrepos:');
    expect(await depRules(root, at("v0.23.0"))).toEqual([]);
    const latest = await partFixture();
    await setTask(
      latest,
      T01,
      "[orders]",
      "Run go get golang.org/x/net@latest; `make test` passes",
    );
    expect(await depRules(latest, at("v0.23.0"))).toEqual([]);
  });

  test("an epic that bumps nothing gets no E-DEP-001", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "`make test` passes");
    expect(
      await depRules(root, new Map([["golang.org/x/net", [XNET("webshop", "v0.23.0")]]])),
    ).toEqual([]);
  });
});

describe("review fixes: a release task must push a matching tag", () => {
  test("a quoted research line, a rollout's tag, or unrelated tags are no release", async () => {
    for (const [task, parts, notes] of [
      [
        T02,
        "[storefront]",
        "Research says: storefront .github/workflows/release.yml pushes ghcr.io/pm-example/storefront on a v* tag.",
      ],
      [
        T04,
        "[argocd/workloads/storefront]",
        "Set the image tag v2.3.1 with newTag in workloads/storefront/kustomization.yaml.",
      ],
      [T03, "[]", "Push the docs to the wiki and add tags."],
    ] as const) {
      const root = await crossFixture();
      await setTask(root, T01, "[storefront]", "`npm test` passes");
      await setTask(root, task, parts, notes);
      expect({ notes, found: ids(await crossRules(root)).includes("E-REL-001 epic.md") }).toEqual({
        notes,
        found: true,
      });
    }
  });
});

describe("cuts after the paired run", () => {
  test("the plan line's own wording, a line break, and one task that releases and rolls out are the release", async () => {
    for (const notes of [
      "Push a `v*` tag (the release).",
      "Cut and push a new\n`v*` tag for storefront.",
    ]) {
      const root = await crossFixture();
      await setTask(root, T01, "[storefront]", "`npm test` passes");
      await setTask(root, T02, "[storefront]", notes);
      expect({ notes, found: ids(await crossRules(root)).includes("E-REL-001 epic.md") }).toEqual({
        notes,
        found: false,
      });
    }
    const both = await crossFixture();
    await setTask(both, T01, "[storefront]", "`npm test` passes");
    await setTask(
      both,
      T02,
      "[storefront, argocd/workloads/storefront]",
      "Push a v* tag, then set newTag in workloads/storefront/kustomization.yaml.",
    );
    expect(await crossRules(both)).toEqual([]);
  });

  test("a task in a repo the epic's repos: lacks is named, with the fix", async () => {
    const root = await crossFixture();
    await edit(root, EPIC, `\n  - ${ARGO_URL}`, "");
    await setTask(
      root,
      T04,
      "[argocd/workloads/storefront]",
      "Set newTag in workloads/storefront/kustomization.yaml.",
    );
    const found = (await crossRules(root)).filter((f) => f.rule === "E-PRT-002");
    expect(found).toHaveLength(1);
    expect(found[0]?.fix).toContain(ARGO_URL);
  });

  test("a dep-skip that only cites the scan is no reason; one with evidence is", async () => {
    const carriers = new Map([["golang.org/x/net", [XNET("webshop", "v0.23.0")]]]);
    const run = async (reason: string) => {
      const root = await partFixture();
      await setTask(
        root,
        T01,
        "[orders]",
        "Run go get golang.org/x/net@v0.36.0; `make test` passes",
      );
      await edit(root, EPIC, "\nrepos:", `\ndep-skip:\n  - "webshop: ${reason}"\nrepos:`);
      return check(await loadPmRepo(root), {
        ...OPTS,
        epic: "app-performance",
        catalog: CATALOG,
        carriers,
      }).filter((f) => f.rule === "E-DEP-001");
    };
    const scanOnly = await run("not in the scan's flagged list");
    expect(scanOnly).toHaveLength(1);
    expect(scanOnly[0]?.message).toContain("no proof");
    expect(await run("not deployed anywhere; the service was retired")).toEqual([]);
  });

  test("the E-DEP-001 hint shows dep-skip as a list item, which survives a comma", async () => {
    const root = await partFixture();
    await setTask(root, T01, "[orders]", "Run go get golang.org/x/net@v0.36.0; `make test` passes");
    const carriers = new Map([["golang.org/x/net", [XNET("webshop", "v0.23.0")]]]);
    const [f] = check(await loadPmRepo(root), {
      ...OPTS,
      epic: "app-performance",
      catalog: CATALOG,
      carriers,
    }).filter((x) => x.rule === "E-DEP-001");
    expect(f?.fix).toContain('dep-skip:\n  - "webshop: <why it is not affected>"');
  });
});
