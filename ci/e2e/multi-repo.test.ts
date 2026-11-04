import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists, gitOk, makeTempDir } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { pmProcess } from "./pm";
import { buildBase, TARGETS, type TargetName } from "./workspace";

const NAMES = Object.keys(TARGETS) as TargetName[];

const commitCount = async (dir: string) =>
  Number((await gitOk(["rev-list", "--count", "HEAD"], dir)).trim());

describe("base workspace", () => {
  test("four repos, one commit each, targets mapped", async () => {
    const dir = await makeTempDir("multi-repo");
    const ws = await buildBase(dir);
    expect(await commitCount(ws.manager)).toBe(1);
    expect((await gitOk(["remote", "get-url", "origin"], ws.manager)).trim()).toBe(
      join(dir, "remotes", "manager.git"),
    );
    for (const name of NAMES) {
      expect(await commitCount(ws.repos[name])).toBe(1);
      expect((await gitOk(["remote", "get-url", "origin"], ws.repos[name])).trim()).toBe(
        TARGETS[name],
      );
    }
    const map = JSON.parse(
      await readFile(join(ws.manager, "docs/pm/.local/repos.json"), "utf8"),
    ) as Record<string, string>;
    expect(map).toEqual({
      [TARGETS.webshop]: ws.repos.webshop,
      [TARGETS.infra]: ws.repos.infra,
      [TARGETS.argocd]: ws.repos.argocd,
    });
    const status = await pmProcess(ws.manager, ["status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("remote: ok");
    expect(status.stdout).toContain("no epics under docs/pm");
  });

  test("building twice into the same directory starts clean", async () => {
    const dir = await makeTempDir("multi-repo");
    const first = await buildBase(dir);
    await writeFile(join(first.repos.infra, "stray.txt"), "left over\n");
    const second = await buildBase(dir);
    expect(await commitCount(second.repos.infra)).toBe(1);
    expect(await exists(join(second.repos.infra, "stray.txt"))).toBe(false);
  });
});
