import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadCatalog,
  lookupMapped,
  normalizeRepoUrl,
  projectFileText,
  renderProjectsIndex,
  sameRepo,
} from "../scripts/projects";
import { makeTempDir, writeTree } from "./helpers";

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
