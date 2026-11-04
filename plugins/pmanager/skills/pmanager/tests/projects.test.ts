import { describe, expect, test } from "bun:test";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  addProject,
  availability,
  loadCatalog,
  lookupMapped,
  normalizeRepoUrl,
  projectFileText,
  renderProjectsIndex,
  sameRepo,
} from "../scripts/projects";
import { worktreePath } from "../scripts/worktree";
import {
  exists,
  gitOk,
  initGitRepo,
  makeTempDir,
  remoteWithClones,
  runPm,
  unclaimedSeed,
  writeTree,
} from "./helpers";

const INFRA = {
  id: "infra",
  name: "Infra",
  url: "https://github.com/pm-example/infra.git",
  added: "2026-10-19",
};

describe("repository identity", () => {
  test("scp, ssh and https forms of one repo normalize alike", () => {
    for (const url of [
      "git@GitHub.com:pm-example/infra.git",
      "https://github.com/pm-example/infra",
      "ssh://git@github.com/pm-example/infra.git",
    ]) {
      expect(normalizeRepoUrl(url)).toBe("github.com/pm-example/infra");
    }
  });

  test("sameRepo compares normalized forms", () => {
    expect(sameRepo("git@github.com:o/r.git", "https://github.com/o/r/")).toBe(true);
    expect(sameRepo("https://github.com/o/r", "https://github.com/x/r")).toBe(false);
  });

  test("lookupMapped tries the exact key, then the same repo", () => {
    expect(lookupMapped({ "https://github.com/o/r.git": "/a" }, "git@github.com:o/r.git")).toBe(
      "/a",
    );
    expect(
      lookupMapped(
        { "https://github.com/o/r.git": "/normalized", "git@github.com:o/r.git": "/exact" },
        "git@github.com:o/r.git",
      ),
    ).toBe("/exact");
    expect(lookupMapped({}, "https://github.com/o/r")).toBeUndefined();
  });
});

describe("catalog files", () => {
  test("loadCatalog keeps valid projects and reports broken files", async () => {
    const root = await makeTempDir("catalog");
    await writeTree(root, {
      "docs/pm/projects/infra.md": projectFileText(INFRA),
      "docs/pm/projects/bad.md": "---\nid: bad\nname: Bad\nadded: 2026-10-19\n---\n\n# Bad\n",
      "docs/pm/projects/other.md": projectFileText({ ...INFRA, id: "different" }),
      "docs/pm/projects/INDEX.md": "# Projects\n",
    });
    const c = await loadCatalog(join(root, "docs/pm"));
    expect(c.projects.map((p) => p.id)).toEqual(["infra"]);
    expect(c.projects[0]?.file.endsWith("docs/pm/projects/infra.md")).toBe(true);
    expect(c.invalid.map((i) => i.file.split("/").pop()).sort()).toEqual(["bad.md", "other.md"]);
    expect(c.index).toBe("# Projects\n");
  });

  test("no projects folder is an empty catalog", async () => {
    const root = await makeTempDir("catalog");
    expect(await loadCatalog(join(root, "docs/pm"))).toEqual({
      projects: [],
      invalid: [],
      index: null,
    });
  });

  test("projectFileText round-trips and leaves Notes to the user", async () => {
    const text = projectFileText(INFRA);
    expect(text).toContain("# Infra");
    expect(text).toContain("## Notes");
    const root = await makeTempDir("catalog");
    await writeTree(root, { "docs/pm/projects/infra.md": text });
    const [p] = (await loadCatalog(join(root, "docs/pm"))).projects;
    expect({ id: p?.id, name: p?.name, url: p?.url, added: p?.added }).toEqual(INFRA);
  });

  test("renderProjectsIndex lists projects by id with their short repo", () => {
    const argocd = {
      ...INFRA,
      id: "argocd",
      name: "Argo CD",
      url: "git@github.com:pm-example/argocd.git",
      file: "",
    };
    const index = renderProjectsIndex([{ ...INFRA, file: "" }, argocd]);
    expect(index).toContain("| Project | Name | Repo | Added |");
    expect(index.indexOf("[argocd]")).toBeLessThan(index.indexOf("[infra]"));
    expect(index).toContain("pm-example/infra");
  });
});

async function manager(): Promise<string> {
  const root = await makeTempDir("manager");
  await initGitRepo(root);
  return root;
}

/** A target checkout named `name`, with `origin` set when given. */
async function checkout(name: string, origin?: string): Promise<string> {
  const dir = join(await makeTempDir("targets"), name);
  await mkdir(dir);
  await initGitRepo(dir);
  if (origin) await gitOk(["remote", "add", "origin", origin], dir);
  return dir;
}

const HTTPS_INFRA = "https://github.com/acme/infra.git";
const opts = { today: "2026-10-19" };

describe("addProject", () => {
  test("a path registers the checkout's origin, maps it and commits nothing", async () => {
    const root = await manager();
    const infra = await checkout("infra", HTTPS_INFRA);
    const r = await addProject(root, infra, opts);
    if (!r.ok) throw new Error(r.message);
    expect(r.project).toMatchObject({
      id: "infra",
      name: "infra",
      url: HTTPS_INFRA,
      added: "2026-10-19",
    });
    expect(r.created).toBe(true);
    expect(r.mapped).toBe(await realpath(infra));
    expect(r.written.map((f) => f.split("docs/pm/")[1])).toEqual([
      "projects/infra.md",
      "projects/INDEX.md",
    ]);
    const map = JSON.parse(await readFile(join(root, "docs/pm/.local/repos.json"), "utf8"));
    expect(map).toEqual({ [HTTPS_INFRA]: await realpath(infra) });
    const untracked = await gitOk(["status", "--porcelain", "-uall"], root);
    expect(untracked).toContain("?? docs/pm/projects/infra.md");
    expect(untracked).toContain("?? docs/pm/projects/INDEX.md");
    expect((await gitOk(["rev-list", "--count", "HEAD"], root)).trim()).toBe("1");
  });

  test("a URL registers unmapped; --name sets the display name", async () => {
    const root = await manager();
    const r = await addProject(root, "https://github.com/acme/argocd.git", {
      ...opts,
      name: "Argo CD",
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.project).toMatchObject({ id: "argocd", name: "Argo CD" });
    expect(r.mapped).toBeNull();
  });

  test("another URL form of a registered repo only maps the checkout", async () => {
    const root = await manager();
    await addProject(root, HTTPS_INFRA, opts);
    const scp = await checkout("infra", "git@github.com:acme/infra.git");
    const r = await addProject(root, scp, opts);
    if (!r.ok) throw new Error(r.message);
    expect(r.created).toBe(false);
    expect(r.project.id).toBe("infra");
    expect(r.mapped).toBe(await realpath(scp));
    expect(r.written).toEqual([]);
  });

  test("a different repo with a taken id needs --id", async () => {
    const root = await manager();
    await addProject(root, HTTPS_INFRA, opts);
    const other = await checkout("infra", "https://github.com/other/infra.git");
    const refused = await addProject(root, other, opts);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("--id");
    const r = await addProject(root, other, { ...opts, id: "other-infra" });
    expect(r.ok && r.project.id).toBe("other-infra");
  });

  test("the manager itself and a checkout without origin are refused", async () => {
    const root = await manager();
    const self = await addProject(root, root, opts);
    expect(self.ok).toBe(false);
    const bare = await checkout("scratch");
    const noOrigin = await addProject(root, bare, opts);
    expect(noOrigin.ok).toBe(false);
    if (!noOrigin.ok) expect(noOrigin.message).toContain("no origin");
  });

  test("from an epic worktree the files land in the main checkout", async () => {
    const { a } = await remoteWithClones(await unclaimedSeed());
    expect((await runPm(["claim", "app-performance"], a, { env: { PM_HARNESS: "t" } })).code).toBe(
      0,
    );
    const wt = worktreePath(a, "app-performance");
    const r = await addProject(wt, await checkout("infra", HTTPS_INFRA), opts);
    if (!r.ok) throw new Error(r.message);
    expect(await exists(join(a, "docs/pm/projects/infra.md"))).toBe(true);
    expect((await gitOk(["status", "--porcelain"], wt)).trim()).toBe("");
  });
});

describe("availability", () => {
  test("available, not mapped, missing and origin mismatch", async () => {
    const root = await manager();
    const infra = await checkout("infra", HTTPS_INFRA);
    const argocd = await checkout("argocd", "https://github.com/acme/argocd.git");
    await addProject(root, infra, opts);
    await addProject(root, "https://github.com/acme/webshop.git", opts);
    const [project] = (await loadCatalog(join(root, "docs/pm"))).projects.filter(
      (p) => p.id === "infra",
    );
    if (!project) throw new Error("infra missing");
    const real = await realpath(infra);
    expect(await availability(project, { [HTTPS_INFRA]: real })).toEqual({
      state: "available",
      path: real,
    });
    expect(await availability(project, {})).toEqual({ state: "not mapped" });
    expect(await availability(project, { [HTTPS_INFRA]: "/nowhere/infra" })).toEqual({
      state: "missing",
      path: "/nowhere/infra",
    });
    expect(await availability(project, { [HTTPS_INFRA]: argocd })).toEqual({
      state: "origin mismatch",
      path: argocd,
      origin: "https://github.com/acme/argocd.git",
    });
  });
});
