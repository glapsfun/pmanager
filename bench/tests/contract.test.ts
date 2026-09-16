import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  EPIC_REQUIRED_FIELDS,
  EPIC_REQUIRED_SECTIONS,
  EPIC_V1_FIELDS,
  PLAN_REQUIRED_SECTIONS,
  TASK_REQUIRED_FIELDS,
  TASK_REQUIRED_SECTIONS,
} from "../../plugins/pmanager/skills/pmanager/scripts/contract";
import {
  LOG_END,
  LOG_START,
  TASKS_END,
  TASKS_START,
} from "../../plugins/pmanager/skills/pmanager/scripts/render";
import { buildWebshopRepo } from "../../plugins/pmanager/skills/pmanager/tests/fixtures/build-webshop";
import { gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { CONTRACT_REL, installContract, renderContract } from "../contract";

describe("neutral contract", () => {
  test("names every required field, section and marker, and no workflow vocabulary", () => {
    const c = renderContract();
    for (const f of [...EPIC_REQUIRED_FIELDS, ...EPIC_V1_FIELDS, ...TASK_REQUIRED_FIELDS]) {
      expect(c).toContain(`\`${f}\``);
    }
    for (const s of [
      ...EPIC_REQUIRED_SECTIONS,
      ...TASK_REQUIRED_SECTIONS,
      ...PLAN_REQUIRED_SECTIONS,
    ]) {
      expect(c).toContain(`## ${s}`);
    }
    for (const m of [TASKS_START, TASKS_END, LOG_START, LOG_END]) expect(c).toContain(m);
    expect(c).toContain("status: draft");
    expect(c).toContain("**unverified**");
    expect(c).not.toMatch(/\bPhase\b|\bledger\b|\belicit|\bMoSCoW\b|\bRICE\b/);
    expect(renderContract()).toBe(c);
  });

  test("installContract writes the file into the fixture and excludes it from git", async () => {
    const dir = await makeTempDir("bench-contract");
    await buildWebshopRepo(dir);
    const text = await installContract(dir);
    expect(await readFile(join(dir, CONTRACT_REL), "utf8")).toBe(text);
    expect((await stat(join(dir, CONTRACT_REL))).isFile()).toBe(true);
    expect((await gitOk(["status", "--porcelain"], dir)).trim()).toBe("");
  });
});
