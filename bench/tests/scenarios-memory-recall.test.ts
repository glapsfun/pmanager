import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { check } from "../../plugins/pmanager/skills/pmanager/scripts/check";
import { getString, sectionBody } from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import { loadPmRepo } from "../../plugins/pmanager/skills/pmanager/scripts/repo";
import { buildStatus, formatStatus } from "../../plugins/pmanager/skills/pmanager/scripts/status";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { FixtureInfo } from "../fixture";
import { CHECK_OPTS } from "../graders/context";
import { memoryRecall } from "../scenarios/memory-recall";
import {
  buildMemoryRecallFixture,
  LESSON_EPIC,
  MEMO_LESSON_LINE,
  NEAR_MISS_EPIC,
  PRIOR_EPICS,
  STALE_MEMO_LINE,
} from "../scenarios/memory-recall-fixture";
import { PM_TODAY } from "../skill-paths";

let dir = "";
let info: FixtureInfo;

beforeAll(async () => {
  dir = await makeTempDir("bench-recall");
  info = await buildMemoryRecallFixture(dir);
});

function indexRow(index: string, slug: string): string {
  return index.split("\n").find((l) => l.startsWith(`| [${slug}]`)) ?? "";
}

describe("memory-recall fixture", () => {
  test("twelve done epics, rendered views, a clean tree and zero check findings", async () => {
    const repo = await loadPmRepo(dir);
    expect(repo.epics.map((e) => e.slug).sort()).toEqual([...PRIOR_EPICS].sort());
    expect(PRIOR_EPICS).toHaveLength(12);
    for (const e of repo.epics) {
      expect(getString(e.epic?.frontmatter ?? {}, "status")).toBe("done");
      expect(e.epic?.frontmatter.session).toBeUndefined();
    }
    expect(check(repo, CHECK_OPTS)).toEqual([]);
    expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
    expect(info.epicSlugsBefore).toEqual([...PRIOR_EPICS]);
    expect(info.baselineSha).toBe((await gitOk(["rev-parse", "HEAD"], dir)).trim());
    // buildWebshopRepo makes 3 commits (an empty init plus two); the fixture adds code and docs/pm
    expect((await gitOk(["log", "--oneline"], dir)).trim().split("\n")).toHaveLength(5);
  });

  test("pm status prints every epic and both seeded memo lines", async () => {
    const out = formatStatus(
      buildStatus(await loadPmRepo(dir), null, "none", { staleDays: 14, today: PM_TODAY }),
    );
    for (const slug of PRIOR_EPICS) expect(out).toContain(slug);
    expect(out).toContain(MEMO_LESSON_LINE);
    expect(out).toContain(STALE_MEMO_LINE);
  });

  test("the seeded memo lines sit mid-list among 40 conventions", async () => {
    const memo = (await loadPmRepo(dir)).memo?.raw ?? "";
    const bullets = (sectionBody(memo, "4. Conventions & constraints") ?? "")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
    expect(bullets).toHaveLength(40);
    expect(bullets[20]).toBe(MEMO_LESSON_LINE);
    expect(bullets[32]).toBe(STALE_MEMO_LINE);
  });

  test("no trap is readable from code", async () => {
    const files = (await gitOk(["ls-files"], dir))
      .split("\n")
      .filter((p) => p !== "" && !p.startsWith("docs/pm/"));
    for (const p of files) {
      const text = await Bun.file(join(dir, p)).text();
      expect({ p, legal: /legal/i.test(text) }).toEqual({ p, legal: false });
      expect({ p, ld: /launch\s?darkly/i.test(text) }).toEqual({ p, ld: false });
    }
    const mailer = await Bun.file(join(dir, "app", "mailer.py")).text();
    expect(mailer).not.toMatch(/newsletter|alert|marketing|spam|reserved|order mail/i);
    expect(await Bun.file(join(dir, "config", "flags.yaml")).text()).toContain("rollout_percent");
    for (const p of files.filter((f) => f !== "app/mailer.py")) {
      const text = await Bun.file(join(dir, p)).text();
      expect({ p, stream: /stream/i.test(text) }).toEqual({ p, stream: false });
    }
  });

  test("the code agrees with the memo and the done epics, apart from the seeded flag line", async () => {
    const app = await Bun.file(join(dir, "app", "app.py")).text();
    expect(app).toContain("LIMIT 50");
    expect(app).toContain("register_blueprint(catalog)");
    expect(app).toMatch(/order_id IN/);
    expect(app).not.toMatch(/N\+1/);
    const schema = await Bun.file(join(dir, "app", "schema.sql")).text();
    expect(schema).toContain("total_cents INTEGER NOT NULL");
    expect(schema).not.toMatch(/\btotal REAL\b/);
  });

  test("the code shows both streams and the default, and nothing about which mail goes where", async () => {
    const mailer = await Bun.file(join(dir, "app", "mailer.py")).text();
    expect(mailer).toContain('STREAMS = ("transactional", "bulk")');
    expect(mailer).toContain('stream="transactional"');
    expect(mailer).not.toMatch(/orders@|news@/);
    const files = (await gitOk(["ls-files"], dir))
      .split("\n")
      .filter((p) => p !== "" && !p.startsWith("docs/pm/") && p !== "app/mailer.py");
    for (const p of files) {
      const text = await Bun.file(join(dir, p)).text();
      expect({ p, hint: /mailer|order-confirmation|confirm_order/.test(text) }).toEqual({
        p,
        hint: false,
      });
    }
    const lesson = (await loadPmRepo(dir)).epics.find((e) => e.slug === LESSON_EPIC);
    expect(lesson?.epic?.body ?? "").not.toContain("@shop.example");
  });

  test("the Legal rule postdates deals-newsletter, and Legal appears only in the memo", async () => {
    const ruleDate = /\[user, (\d{4}-\d{2}-\d{2})\]$/.exec(MEMO_LESSON_LINE)?.[1] ?? "";
    const repo = await loadPmRepo(dir);
    const lesson = repo.epics.find((e) => e.slug === LESSON_EPIC);
    expect(ruleDate > (getString(lesson?.epic?.frontmatter ?? {}, "updated") ?? "")).toBe(true);
    expect(ruleDate < "2026-09-10").toBe(true);
    const pm = (await gitOk(["ls-files", "docs/pm"], dir)).split("\n").filter((p) => p !== "");
    for (const p of pm.filter((f) => f !== "docs/pm/pmanager-memo.md")) {
      const text = await Bun.file(join(dir, p)).text();
      expect({ p, legal: /legal/i.test(text) }).toEqual({ p, legal: false });
    }
    for (const e of repo.epics) {
      if ((getString(e.epic?.frontmatter ?? {}, "updated") ?? "") <= ruleDate) continue;
      const text = [e.epic?.raw, e.plan?.raw, ...e.tasks.map((t) => t.raw)].join("\n");
      expect({ slug: e.slug, mail: /e-?mail|newsletter|mailer/i.test(text) }).toEqual({
        slug: e.slug,
        mail: false,
      });
    }
  });

  test("jobs, migrations, flags and copy agree with the memo and the epics", async () => {
    const cron = await Bun.file(join(dir, "deploy", "cron.yaml")).text();
    const modules = [...cron.matchAll(/python -m ([\w.]+)/g)].map((m) => m[1] as string);
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      const path = `${m.replaceAll(".", "/")}.py`;
      expect({ path, exists: await Bun.file(join(dir, path)).exists() }).toEqual({
        path,
        exists: true,
      });
    }
    const migrations = (await gitOk(["ls-files", "migrations"], dir)).split("\n").filter(Boolean);
    const sql = (await Promise.all(migrations.map((p) => Bun.file(join(dir, p)).text()))).join(
      "\n",
    );
    expect(sql).toContain("ADD COLUMN total_cents");
    expect(sql).toContain("DROP COLUMN total");
    const flags = await Bun.file(join(dir, "config", "flags.yaml")).text();
    expect(flags).toMatch(/review_moderation:\n {2}enabled: true\n {2}rollout_percent: 100/);
    const memo = (await loadPmRepo(dir)).memo?.raw ?? "";
    expect(memo).not.toContain("not straight to code");
    expect(sectionBody(memo, "3. Stakeholders") ?? "").toMatch(/^\| legal \|/im);
  });

  test("every repo path the memo names exists", async () => {
    const memo = (await loadPmRepo(dir)).memo?.raw ?? "";
    const named = [
      ...[...memo.matchAll(/`([\w.-]+\/[\w./-]*)`/g)].map((m) => m[1] as string),
      ...[...memo.matchAll(/\[([\w.-]+\/[\w./-]+), \d{4}-\d{2}-\d{2}\]/g)].map(
        (m) => m[1] as string,
      ),
    ];
    expect(named.length).toBeGreaterThan(4);
    const tracked = (await gitOk(["ls-files"], dir)).split("\n");
    for (const p of named) {
      const hit = tracked.some((t) => (p.endsWith("/") ? t.startsWith(p) : t === p));
      expect({ p, hit }).toEqual({ p, hit: true });
    }
  });

  test("fixture commits are dated on or before the epics' last update", async () => {
    const log = (await gitOk(["log", "-2", "--format=%aI %cI %s"], dir)).trim().split("\n");
    expect(log).toHaveLength(2);
    for (const line of log) {
      const [authored, committed] = line.split(" ");
      expect((authored ?? "").slice(0, 10) <= "2026-09-10").toBe(true);
      expect((committed ?? "").slice(0, 10) <= "2026-09-10").toBe(true);
    }
    expect(log[0]).toEndWith("docs(pm): record past epics and the product memo");
  });

  test("the lesson epic's INDEX row avoids likely research keywords; the near miss shares one", async () => {
    const index = (await loadPmRepo(dir)).index ?? "";
    const lesson = indexRow(index, LESSON_EPIC).toLowerCase();
    expect(lesson).not.toBe("");
    for (const kw of [
      "email",
      "mail",
      "notify",
      "notification",
      "restock",
      "stock",
      "alert",
      "subscribe",
      "product",
      "shopper",
      "rollout",
      "flag",
    ]) {
      expect({ kw, hit: lesson.includes(kw) }).toEqual({ kw, hit: false });
    }
    expect(indexRow(index, NEAR_MISS_EPIC).toLowerCase()).toContain("restock");
  });
});

describe("memory-recall request", () => {
  test("the scenario grades a spec log for the new epic, not the prior epics' logs", () => {
    expect(memoryRecall.checks.map((c) => c.id)).toContain("new-spec-log");
  });

  test("the request names neither a trap nor the skill", () => {
    for (const word of [
      "legal",
      "legal-review",
      "bulk",
      "transactional",
      "stream",
      "launchdarkly",
      "flag",
      "deals-newsletter",
      "newsletter",
      "flags-in-repo",
      "pmanager",
    ]) {
      expect({ word, hit: memoryRecall.task.toLowerCase().includes(word) }).toEqual({
        word,
        hit: false,
      });
    }
  });

  test("the lesson epic's INDEX row shares no word with the request", async () => {
    // title and primary metric only: the link cell holds "epic.md", and the request says "epic"
    const cells = indexRow((await loadPmRepo(dir)).index ?? "", LESSON_EPIC).split("|");
    const words = `${cells[2]} ${cells[9]}`.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    expect(words.length).toBeGreaterThan(3);
    const task = memoryRecall.task.toLowerCase();
    for (const w of words) expect({ w, hit: task.includes(w) }).toEqual({ w, hit: false });
  });
});
