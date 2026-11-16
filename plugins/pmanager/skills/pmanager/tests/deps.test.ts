import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CarrierReport,
  carriersAcross,
  compareVersions,
  formatDepsBlock,
  matchesPackage,
  parseDeps,
} from "../scripts/deps";
import type { Catalog } from "../scripts/projects";
import { gitOk, initGitRepo, makeTempDir, writeTree } from "./helpers";

const NPM_LOCK = JSON.stringify(
  {
    name: "storefront",
    lockfileVersion: 3,
    packages: {
      "": { name: "storefront", dependencies: { express: "4.21.1", foo: "1.0.0" } },
      "node_modules/express": { version: "4.21.1", dependencies: { "path-to-regexp": "0.1.10" } },
      "node_modules/foo": { version: "1.0.0", dependencies: { "path-to-regexp": "0.1.7" } },
      "node_modules/foo/node_modules/path-to-regexp": { version: "0.1.7" },
      "node_modules/path-to-regexp": { version: "0.1.10" },
    },
  },
  null,
  2,
);

const lineOf = (raw: string, needle: string) =>
  raw.slice(0, raw.indexOf(needle)).split("\n").length;

describe("package-lock.json", () => {
  test("each copy is its own dep, with the shortest chain from a root dependency", () => {
    const { deps } = parseDeps("package-lock.json", NPM_LOCK);
    const p2r = deps.filter((d) => d.name === "path-to-regexp");
    expect(p2r.map((d) => [d.version, d.direct, d.via])).toEqual([
      ["0.1.7", false, "foo 1.0.0"],
      ["0.1.10", false, "express 4.21.1"],
    ]);
    const top = p2r.find((d) => d.version === "0.1.10");
    expect(top?.line).toBe(lineOf(NPM_LOCK, '"node_modules/path-to-regexp"'));
    expect(deps.find((d) => d.name === "express")).toMatchObject({
      direct: true,
      via: null,
      ecosystem: "npm",
    });
  });

  test("a truncated lockfile is skipped, not thrown", () => {
    const r = parseDeps("package-lock.json", "{ truncated");
    expect(r.deps).toEqual([]);
    expect(r.skipped).toContain("invalid");
  });
});

describe("bun.lock", () => {
  test("the text lockfile gives the same deps", () => {
    const raw = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "storefront", "dependencies": { "express": "4.21.1", "foo": "1.0.0", }, },
  },
  "packages": {
    "express": ["express@4.21.1", "", { "dependencies": { "path-to-regexp": "0.1.10" } }, "sha512-a"],
    "foo": ["foo@1.0.0", "", { "dependencies": { "path-to-regexp": "0.1.7" } }, "sha512-b"],
    "foo/path-to-regexp": ["path-to-regexp@0.1.7", "", {}, "sha512-c"],
    "path-to-regexp": ["path-to-regexp@0.1.10", "", {}, "sha512-d"],
  },
}
`;
    const { deps } = parseDeps("bun.lock", raw);
    expect(deps.filter((d) => d.name === "path-to-regexp").map((d) => [d.version, d.via])).toEqual([
      ["0.1.7", "foo 1.0.0"],
      ["0.1.10", "express 4.21.1"],
    ]);
  });
});

describe("go.mod", () => {
  test("direct and indirect requires, with their lines", () => {
    const raw =
      "module github.com/pm-example/webshop\n\ngo 1.23\n\nrequire github.com/gorilla/websocket v1.5.2\n\nrequire golang.org/x/net v0.23.0 // indirect\n";
    const { deps } = parseDeps("go.mod", raw);
    expect(deps.map((d) => [d.name, d.version, d.direct, d.via, d.line])).toEqual([
      ["github.com/gorilla/websocket", "v1.5.2", true, null, 5],
      ["golang.org/x/net", "v0.23.0", false, null, 7],
    ]);
  });
});

describe("Python lockfiles", () => {
  test("uv.lock gives versions and the chain from the project", () => {
    const raw = `version = 1

[[package]]
name = "requests"
version = "2.34.2"
dependencies = [{ name = "urllib3" }]

[[package]]
name = "urllib3"
version = "2.8.0"

[[package]]
name = "worker"
version = "0.4.0"
source = { virtual = "." }
dependencies = [{ name = "requests" }]
`;
    const { deps } = parseDeps("uv.lock", raw);
    expect(deps.find((d) => d.name === "requests")).toMatchObject({
      version: "2.34.2",
      direct: true,
      via: null,
      line: 4,
      ecosystem: "pypi",
    });
    expect(deps.find((d) => d.name === "urllib3")).toMatchObject({
      direct: false,
      via: "requests 2.34.2",
    });
    expect(deps.some((d) => d.name === "worker")).toBe(false);
  });

  test("poetry.lock is direct when the pyproject beside it lists the package", () => {
    const raw = '[[package]]\nname = "requests"\nversion = "2.31.0"\n';
    const pyproject = '[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "^2.31"\n';
    expect(parseDeps("poetry.lock", raw, { pyproject }).deps).toEqual([
      expect.objectContaining({ name: "requests", version: "2.31.0", direct: true }),
    ]);
  });

  test("requirements.txt counts exact pins only", () => {
    const raw =
      "# runtime\nrequests==2.31.0 ; python_version >= '3.11'\nurllib3>=2\nidna[all]==3.7\n";
    expect(parseDeps("requirements.txt", raw).deps.map((d) => [d.name, d.version, d.line])).toEqual(
      [
        ["requests", "2.31.0", 2],
        ["idna", "3.7", 4],
      ],
    );
  });
});

describe("Dockerfile", () => {
  test("a base image is a dep; a stage name is not", () => {
    const raw =
      "FROM node:20.18.1-alpine3.20 AS build\nRUN npm ci\nFROM build\nFROM --platform=linux/amd64 gcr.io/distroless/static\n";
    expect(
      parseDeps("Dockerfile", raw).deps.map((d) => [d.name, d.version, d.ecosystem, d.line]),
    ).toEqual([
      ["node", "20.18.1-alpine3.20", "image", 1],
      ["gcr.io/distroless/static", "latest", "image", 4],
    ]);
  });
});

describe("matchesPackage", () => {
  const dep = (name: string, ecosystem: "npm" | "go" | "image", version = "1.0.0") => ({
    name,
    ecosystem,
    version,
  });
  test("exact names ignoring case; Go module path suffixes that carry a slash", () => {
    expect(matchesPackage("x/net", dep("golang.org/x/net", "go"))).toBe(true);
    expect(matchesPackage("net", dep("golang.org/x/net", "go"))).toBe(false);
    expect(matchesPackage("Express", dep("express", "npm"))).toBe(true);
    expect(matchesPackage("express", dep("express-session", "npm"))).toBe(false);
    expect(matchesPackage("node", dep("node", "image", "20.18.1-alpine3.20"))).toBe(true);
    expect(
      matchesPackage("node:20.18.1-alpine3.20", dep("node", "image", "20.18.1-alpine3.20")),
    ).toBe(true);
  });
});

describe("compareVersions", () => {
  test("semver for npm and Go, pseudo-versions included; null when a side does not compare", () => {
    expect(compareVersions("go", "v0.23.0", "v0.36.0")).toBeLessThan(0);
    expect(compareVersions("npm", "0.1.10", "0.1.12")).toBeLessThan(0);
    expect(compareVersions("go", "v0.0.0-20230101000000-abcdef123456", "v0.36.0")).toBeLessThan(0);
    expect(compareVersions("pypi", "2.34.2", "2.32.4")).toBeGreaterThan(0);
    expect(compareVersions("npm", "latest", "1.0.0")).toBeNull();
    expect(compareVersions("image", "20.18.1-alpine3.20", "20.19.0")).toBeNull();
  });
});

describe("formatDepsBlock", () => {
  const report: CarrierReport = {
    carriers: [
      {
        project: "webshop",
        file: "go.mod",
        line: 7,
        name: "golang.org/x/net",
        version: "v0.23.0",
        ecosystem: "go",
        direct: false,
        via: null,
      },
      {
        project: "storefront",
        file: "package-lock.json",
        line: 262,
        name: "path-to-regexp",
        version: "0.1.10",
        ecosystem: "npm",
        direct: false,
        via: "express 4.21.1",
      },
    ],
    unchecked: [{ project: "worker", availability: "not mapped" }],
    skipped: [],
  };
  test("one line per carrier, then the repos that were not checked", () => {
    const lines = formatDepsBlock(report);
    expect(lines[0]).toBe("deps:");
    expect(lines).toContain("  [webshop go.mod:7] golang.org/x/net v0.23.0 indirect");
    expect(lines).toContain(
      "  [storefront package-lock.json:262] path-to-regexp 0.1.10 via express 4.21.1",
    );
    expect(lines).toContain("  [deps] not checked: worker (not mapped)");
  });
  test("capped, with the rest counted; nothing when no repo carries the package", () => {
    const many = {
      ...report,
      carriers: Array.from({ length: 25 }, (_, i) => ({ ...report.carriers[0], line: i + 1 })),
    } as CarrierReport;
    expect(formatDepsBlock(many, 20).at(-2)).toBe("  +5 more");
    expect(formatDepsBlock({ carriers: [], unchecked: report.unchecked, skipped: [] })).toEqual([]);
  });
});

describe("edge files", () => {
  test("go.sum stands in for presence; a root dependency missing from the lockfile is no chain", () => {
    const sum = "golang.org/x/net v0.23.0 h1:abc=\ngolang.org/x/net v0.23.0/go.mod h1:def=\n";
    expect(parseDeps("go.sum", sum).deps.map((d) => [d.name, d.version, d.line])).toEqual([
      ["golang.org/x/net", "v0.23.0", 1],
    ]);
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { ghost: "1.0.0" } },
        "node_modules/a": { version: "1.0.0" },
      },
    });
    expect(parseDeps("package-lock.json", lock).deps).toEqual([
      expect.objectContaining({ name: "a", direct: false, via: null }),
    ]);
    const bun =
      '{"workspaces":{"":{"dependencies":{"ghost":"1"}}},"packages":{"a/b":["b@2.0.0","",{}]}}';
    expect(parseDeps("bun.lock", bun).deps).toEqual([
      expect.objectContaining({ name: "b", version: "2.0.0", direct: false, via: null }),
    ]);
    expect(
      parseDeps("poetry.lock", '[[package]]\nname = "x"\nversion = "1.0"\n', {
        pyproject: "not = [toml",
      }).deps[0]?.direct,
    ).toBe(false);
    expect(parseDeps("README.md", "anything").deps).toEqual([]);
  });
});

describe("carriersAcross", () => {
  test("reads every mapped checkout and names the repos it could not", async () => {
    const root = await makeTempDir("deps-manager");
    await initGitRepo(root);
    const webshop = await makeTempDir("deps-webshop");
    await initGitRepo(webshop);
    await writeTree(webshop, {
      "go.mod": "module x\n\ngo 1.23\n\nrequire golang.org/x/net v0.23.0 // indirect\n",
    });
    await gitOk(["add", "-A"], webshop);
    await gitOk(["commit", "-q", "-m", "deps"], webshop);
    await gitOk(["remote", "add", "origin", "https://github.com/pm-example/webshop.git"], webshop);
    await mkdir(join(root, "docs/pm/.local"), { recursive: true });
    await writeFile(
      join(root, "docs/pm/.local/repos.json"),
      JSON.stringify({ "https://github.com/pm-example/webshop.git": webshop }),
    );
    const catalog: Catalog = {
      projects: [
        {
          id: "webshop",
          name: "Webshop",
          url: "https://github.com/pm-example/webshop.git",
          added: "2026-11-16",
          file: "webshop.md",
        },
        {
          id: "worker",
          name: "Worker",
          url: "https://github.com/pm-example/worker.git",
          added: "2026-11-16",
          file: "worker.md",
        },
      ],
      invalid: [],
      index: null,
    };
    const r = await carriersAcross(root, catalog, ["x/net"]);
    expect(r.carriers.map((c) => [c.project, c.file, c.line, c.version])).toEqual([
      ["webshop", "go.mod", 5, "v0.23.0"],
    ]);
    expect(r.unchecked).toEqual([{ project: "worker", availability: "not mapped" }]);
  });

  test("reads a poetry project with its pyproject, and reports files it skipped", async () => {
    const root = await makeTempDir("deps-manager");
    await initGitRepo(root);
    const repo = await makeTempDir("deps-worker");
    await initGitRepo(repo);
    await writeTree(repo, {
      "poetry.lock": '[[package]]\nname = "requests"\nversion = "2.31.0"\n',
      "pyproject.toml": '[tool.poetry.dependencies]\nrequests = "^2.31"\n',
      "web/package-lock.json": "{ truncated",
      "big/package-lock.json": `{"pad":"${"x".repeat(11 * 1024 * 1024)}"}`,
    });
    await gitOk(["add", "-A"], repo);
    await gitOk(["commit", "-q", "-m", "deps"], repo);
    await gitOk(["remote", "add", "origin", "https://github.com/pm-example/worker.git"], repo);
    await mkdir(join(root, "docs/pm/.local"), { recursive: true });
    await writeFile(
      join(root, "docs/pm/.local/repos.json"),
      JSON.stringify({ "https://github.com/pm-example/worker.git": repo }),
    );
    const catalog: Catalog = {
      projects: [
        {
          id: "worker",
          name: "Worker",
          url: "https://github.com/pm-example/worker.git",
          added: "2026-11-16",
          file: "worker.md",
        },
      ],
      invalid: [],
      index: null,
    };
    const r = await carriersAcross(root, catalog, ["requests"]);
    expect(r.carriers).toEqual([
      expect.objectContaining({ project: "worker", file: "poetry.lock", direct: true }),
    ]);
    expect(r.skipped.map((s) => [s.file, s.why.split(" ")[0]])).toEqual([
      ["big/package-lock.json", "over"],
      ["web/package-lock.json", "invalid"],
    ]);
    expect(formatDepsBlock(r)).toContain(
      `  [deps] skipped: worker web/package-lock.json: ${r.skipped[1]?.why ?? ""}`,
    );
    expect(await carriersAcross(root, catalog, [])).toEqual({
      carriers: [],
      unchecked: [],
      skipped: [],
    });
  }, 30_000);
});
