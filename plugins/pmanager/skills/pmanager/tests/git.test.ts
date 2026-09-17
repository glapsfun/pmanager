import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fetchOrigin, listFetchedBranches, readFileAtRef } from "../scripts/git";
import { gitOk, makeTempDir, remoteWithClones } from "./helpers";

describe("listFetchedBranches", () => {
  test("reads pm/* from remote-tracking refs after a fetch, sorted, without a network call", async () => {
    const { a, b } = await remoteWithClones({ "README.md": "seed\n" });
    await gitOk(["push", "-q", "origin", "main:pm/zeta"], a);
    await gitOk(["push", "-q", "origin", "main:pm/alpha"], a);
    await gitOk(["push", "-q", "origin", "main:other"], a);
    expect(await listFetchedBranches(b, "pm/")).toEqual([]);
    expect(await fetchOrigin(b)).toBe(true);
    expect(await listFetchedBranches(b, "pm/")).toEqual(["pm/alpha", "pm/zeta"]);
  });

  test("a branch deleted on origin disappears after the next pruned fetch", async () => {
    const { a, b } = await remoteWithClones({ "README.md": "seed\n" });
    await gitOk(["push", "-q", "origin", "main:pm/alpha"], a);
    await fetchOrigin(b);
    expect(await listFetchedBranches(b, "pm/")).toEqual(["pm/alpha"]);
    await gitOk(["push", "-q", "origin", "--delete", "pm/alpha"], a);
    await fetchOrigin(b);
    expect(await listFetchedBranches(b, "pm/")).toEqual([]);
  });
});

describe("fetchOrigin", () => {
  test("a single-branch clone still sees pm/* claims after fetch", async () => {
    const { bare, a } = await remoteWithClones({ "README.md": "seed\n" });
    await gitOk(["push", "-q", "origin", "main:pm/alpha"], a);
    const c = join(await makeTempDir("single"), "c");
    await gitOk(["clone", "-q", "--single-branch", "-b", "main", bare, c], ".");
    expect(await fetchOrigin(c)).toBe(true);
    expect(await listFetchedBranches(c, "pm/")).toEqual(["pm/alpha"]);
    expect(await readFileAtRef(c, "origin/pm/alpha", "README.md")).toBe("seed\n");
  });
});
