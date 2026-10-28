import { expect, test } from "bun:test";
import { type ManifestInput, manifestProblems } from "../checks/manifest";

const valid = (): ManifestInput => ({
  claude: { name: "pmanager", version: "0.10.0" },
  codex: { name: "pmanager", version: "0.10.0" },
  marketplace: { plugins: [{ name: "pmanager", source: "./plugins/pmanager" }] },
  sourceExists: () => true,
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
