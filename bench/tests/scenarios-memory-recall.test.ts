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
