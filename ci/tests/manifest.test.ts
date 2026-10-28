import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeTempDir, writeTree } from "../../plugins/pmanager/skills/pmanager/tests/helpers";
import { type ManifestInput, manifestProblems, skillNames } from "../checks/manifest";
import { REPO_ROOT } from "../packages";

const valid = (): ManifestInput => ({
  claude: { name: "pmanager", version: "0.10.0" },
  codex: { name: "pmanager", version: "0.10.0", skills: "./skills/" },
  marketplace: { plugins: [{ name: "pmanager", source: "./plugins/pmanager" }] },
  sourceExists: () => true,
  skillsIn: (dir) => (dir === "./skills/" ? ["pmanager"] : []),
});

test("valid input has no problems", () => {
  expect(manifestProblems(valid())).toEqual([]);
});

test("version mismatch names both versions", () => {
  const v = valid();
  v.codex.version = "0.11.0";
  const p = manifestProblems(v);
  expect(p).toHaveLength(1);
  expect(p[0]).toContain("0.10.0");
  expect(p[0]).toContain("0.11.0");
});

test("name mismatch", () => {
  const v = valid();
  v.codex.name = "pm";
  expect(manifestProblems(v).join("\n")).toContain("name");
});

test("missing marketplace entry", () => {
  const v = valid();
  v.marketplace = { plugins: [] };
  expect(manifestProblems(v).join("\n")).toContain("marketplace");
});

test("missing source directory", () => {
  const v = valid();
  v.sourceExists = () => false;
  expect(manifestProblems(v).join("\n")).toContain("./plugins/pmanager");
});

test("marketplace version must match", () => {
  const v = valid();
  v.marketplace = {
    plugins: [{ name: "pmanager", source: "./plugins/pmanager", version: "0.9.0" }],
  };
  expect(manifestProblems(v).join("\n")).toContain("0.9.0");
});

test("codex skills path must hold a <name>/SKILL.md", () => {
  const v = valid();
  v.codex.skills = "./nope/";
  expect(manifestProblems(v)).toEqual(["codex skills path ./nope/ has no <name>/SKILL.md"]);
  delete v.codex.skills;
  expect(manifestProblems(v)).toEqual(["codex plugin.json has no skills path"]);
});

test("skillNames lists only directories that hold a SKILL.md", async () => {
  expect(skillNames(join(REPO_ROOT, "plugins", "pmanager", "skills"))).toEqual(["pmanager"]);
  const dir = await makeTempDir("skills");
  await writeTree(dir, { "a/SKILL.md": "# a\n", "b/README.md": "# b\n", "c.md": "c\n" });
  expect(skillNames(dir)).toEqual(["a"]);
  expect(skillNames(join(dir, "c.md"))).toEqual([]);
  expect(skillNames(join(dir, "missing"))).toEqual([]);
});
