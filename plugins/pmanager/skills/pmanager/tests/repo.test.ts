import { describe, expect, test } from "bun:test";
import { epicBySlug, epicId, loadPmRepo, taskById } from "../scripts/repo";
import { makeTempDir, writeTree } from "./helpers";

const MINI = {
  "docs/pm/INDEX.md": "# PM index\n",
  "docs/pm/pmanager-memo.md": "# PManager memo\n",
  "docs/pm/log/2026-09-10-alpha-abc123.md":
    "---\ndate: 2026-09-10\nepic: alpha\nharness: pi\nkind: spec\n---\nspec'd alpha\n",
  "docs/pm/alpha/epic.md": "---\nid: alpha\ntitle: Alpha\nstatus: draft\n---\n\n# Alpha\n",
  "docs/pm/alpha/plan.md": "---\nepic: alpha\nstatus: draft\nupdated: 2026-09-10\n---\n\n# Plan\n",
  "docs/pm/alpha/tasks/T02-second.md": "---\nid: T02\nepic: alpha\n---\n\n# T02\n",
  "docs/pm/alpha/tasks/T01-first.md": "---\nid: T01\nepic: alpha\n---\n\n# T01\n",
  "docs/pm/beta/epic.md": "---\ntitle: Beta without id\n---\n\n# Beta\n",
  "docs/pm/.local/repos.json": "{}",
  "docs/pm/stray.md": "not an epic\n",
};

describe("loadPmRepo", () => {
  test("loads epics, tasks sorted, index, memo, logs", async () => {
    const root = await makeTempDir("repo");
    await writeTree(root, MINI);
    const repo = await loadPmRepo(root);
    expect(repo.pmDir.endsWith("docs/pm")).toBe(true);
    expect(repo.epics.map((e) => e.slug)).toEqual(["alpha", "beta"]);
    const alpha = epicBySlug(repo, "alpha");
    if (!alpha) throw new Error("alpha missing");
    expect(alpha.tasks.map((t) => t.id)).toEqual(["T01", "T02"]);
    expect(alpha.plan?.path.endsWith("alpha/plan.md")).toBe(true);
    expect(taskById(alpha, "T02")?.path.endsWith("T02-second.md")).toBe(true);
    expect(repo.index).toBe("# PM index\n");
    expect(repo.memo?.raw).toBe("# PManager memo\n");
    expect(repo.logs).toHaveLength(1);
    expect(repo.logs[0]?.kind).toBe("spec");
    expect(repo.logs[0]?.message).toBe("spec'd alpha");
  });
  test("epicId falls back to directory name", async () => {
    const root = await makeTempDir("repo");
    await writeTree(root, MINI);
    const repo = await loadPmRepo(root);
    const beta = epicBySlug(repo, "beta");
    const alpha = epicBySlug(repo, "alpha");
    if (!beta || !alpha) throw new Error("epics missing");
    expect(epicId(beta)).toBe("beta");
    expect(epicId(alpha)).toBe("alpha");
  });
  test("throws without docs/pm", async () => {
    const root = await makeTempDir("repo");
    await expect(loadPmRepo(root)).rejects.toThrow("no docs/pm directory");
  });
  test("epic dir without epic.md still loads with epic null", async () => {
    const root = await makeTempDir("repo");
    await writeTree(root, { "docs/pm/gamma/plan.md": "---\nepic: gamma\n---\n" });
    const repo = await loadPmRepo(root);
    expect(repo.epics[0]?.epic).toBeNull();
    expect(repo.index).toBeNull();
    expect(repo.memo).toBeNull();
  });
});
