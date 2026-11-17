import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bumpTargets,
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

describe("bumpTargets", () => {
  test("explicit targets only", () => {
    expect(bumpTargets("go get golang.org/x/net@v0.36.0")).toEqual([
      { name: "golang.org/x/net", version: "v0.36.0" },
    ]);
    expect(bumpTargets("bump express from 4.21.1 to 4.21.2")).toEqual([
      { name: "express", version: "4.21.2" },
    ]);
    expect(bumpTargets("express 4.21.1 pins path-to-regexp 0.1.10")).toEqual([]);
    expect(
      bumpTargets("npm install path-to-regexp@0.1.12 and pip install requests==2.32.4"),
    ).toEqual([
      { name: "path-to-regexp", version: "0.1.12" },
      { name: "requests", version: "2.32.4" },
    ]);
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
    unread: [],
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
    expect(formatDepsBlock(many, 20).at(-2)).toBe("  +5 more in webshop");
    expect(
      formatDepsBlock({ carriers: [], unchecked: report.unchecked, skipped: [], unread: [] }),
    ).toEqual([]);
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
      "web/package-lock.json": '{ "packages": { "node_modules/requests": ',
      "big/package-lock.json": `{"requests":"${"x".repeat(11 * 1024 * 1024)}"}`,
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
      unread: [],
    });
  }, 30_000);
});

describe("review fixes: package facts", () => {
  test("a 3000-entry lockfile parses in well under a second", () => {
    const packages: Record<string, unknown> = { "": { dependencies: { root0: "1.0.0" } } };
    for (let i = 0; i < 3000; i++) {
      packages[`node_modules/pkg${i}`] = {
        version: "1.0.0",
        dependencies: i + 1 < 3000 ? { [`pkg${i + 1}`]: "1.0.0" } : {},
      };
    }
    packages["node_modules/root0"] = { version: "1.0.0", dependencies: { pkg0: "1.0.0" } };
    const raw = JSON.stringify({ lockfileVersion: 3, packages }, null, 2);
    const started = performance.now();
    const { deps } = parseDeps("package-lock.json", raw);
    expect(deps.length).toBe(3001);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("hashed pins and go.mod replace lines", () => {
    const req = "requests==2.31.0 \\\n    --hash=sha256:aaa \\\n    --hash=sha256:bbb\nidna==3.7\n";
    expect(parseDeps("requirements.txt", req).deps.map((d) => [d.name, d.version, d.line])).toEqual(
      [
        ["requests", "2.31.0", 1],
        ["idna", "3.7", 4],
      ],
    );
    const mod =
      "module x\n\nrequire golang.org/x/net v0.23.0 // indirect\n\nreplace golang.org/x/net => golang.org/x/net v0.36.0\n";
    expect(parseDeps("go.mod", mod).deps.find((d) => d.name === "golang.org/x/net")?.version).toBe(
      "v0.36.0",
    );
  });

  test("bumpTargets reads arrows and floors, and not a config key", () => {
    expect(bumpTargets("bump golang.org/x/net v0.23.0 -> v0.36.0")).toEqual([
      { name: "golang.org/x/net", version: "v0.36.0" },
    ]);
    expect(bumpTargets("golang.org/x/net → v0.36.0")).toEqual([
      { name: "golang.org/x/net", version: "v0.36.0" },
    ]);
    expect(bumpTargets("pip install requests>=2.32.4")).toEqual([
      { name: "requests", version: "2.32.4" },
    ]);
    expect(bumpTargets("uv add 'requests>=2.32.4'")).toEqual([
      { name: "requests", version: "2.32.4" },
    ]);
    expect(bumpTargets("Set newTag to 2.3.1 in workloads/storefront/kustomization.yaml")).toEqual(
      [],
    );
  });

  test("every repo keeps a line when one repo has many copies", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      project: "storefront",
      file: "package-lock.json",
      line: i + 1,
      name: "debug",
      version: `2.${i}.0`,
      ecosystem: "npm" as const,
      direct: false,
      via: null,
    }));
    const lines = formatDepsBlock({
      carriers: [...many, { ...many[0], project: "admin", line: 9 } as (typeof many)[number]],
      unchecked: [],
      skipped: [],
      unread: [],
    });
    expect(lines.some((l) => l.startsWith("  [admin "))).toBe(true);
    expect(lines.some((l) => l.includes("more in storefront"))).toBe(true);
  });
});

describe("review fixes: a skipped file that may carry the package", () => {
  async function workerWith(files: Record<string, string>) {
    const root = await makeTempDir("deps-manager");
    await initGitRepo(root);
    const repo = await makeTempDir("deps-worker");
    await initGitRepo(repo);
    await writeTree(repo, files);
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
    return { root, catalog };
  }

  test("an invalid lockfile that names the package is reported even with no carrier", async () => {
    const { root, catalog } = await workerWith({
      "package-lock.json": '{ "packages": { "node_modules/path-to-regexp": ',
    });
    const lines = formatDepsBlock(await carriersAcross(root, catalog, ["path-to-regexp"]));
    expect(lines[0]).toBe("deps: none found");
    expect(lines.join("\n")).toContain("[deps] skipped: worker package-lock.json: invalid");
  });

  test("an invalid lockfile that does not name it prints nothing", async () => {
    const { root, catalog } = await workerWith({ "package-lock.json": "{ truncated" });
    expect(formatDepsBlock(await carriersAcross(root, catalog, ["path-to-regexp"]))).toEqual([]);
  });

  test("a lockfile pm cannot read is named when it names the package", async () => {
    const { root, catalog } = await workerWith({
      "yarn.lock": 'leaf@^1.0.0:\n  version "1.0.0"\n',
      "web/pnpm-lock.yaml": "packages:\n  /leaf@1.0.0:\n    resolution: {}\n",
      "old/bun.lockb": "\u0000\u0001leaf\u0000",
      "other/yarn.lock": 'express@^4.0.0:\n  version "4.21.1"\n',
    });
    const lines = formatDepsBlock(await carriersAcross(root, catalog, ["leaf"]));
    expect(lines[0]).toBe("deps: none found");
    const notes = lines.filter((l) => l.startsWith("  [deps] not read: worker "));
    expect(notes.map((l) => l.split(" ")[6])).toEqual([
      "old/bun.lockb:",
      "web/pnpm-lock.yaml:",
      "yarn.lock:",
    ]);
  });

  test("a lockfile beside one pm reads is not noted", async () => {
    const { root, catalog } = await workerWith({
      "package.json": '{ "dependencies": { "leaf": "1.0.0" } }',
      "package-lock.json": JSON.stringify({
        packages: {
          "": { dependencies: { leaf: "1.0.0" } },
          "node_modules/leaf": { version: "1.0.0" },
        },
      }),
      "yarn.lock": 'leaf@^1.0.0:\n  version "1.0.0"\n',
    });
    const lines = formatDepsBlock(await carriersAcross(root, catalog, ["leaf"]));
    expect(lines.filter((l) => l.includes("not read"))).toEqual([]);
    expect(lines).toContain("  [worker package-lock.json:1] leaf 1.0.0 direct");
  });

  test("a package.json with no lockfile is named when it declares the package", async () => {
    const { root, catalog } = await workerWith({
      "package.json": '{ "name": "legacy", "dependencies": { "leaf": "^1.2.0" } }',
    });
    expect(formatDepsBlock(await carriersAcross(root, catalog, ["leaf"]))).toEqual([
      "deps: none found",
      "  [deps] not read: worker package.json: no lockfile; it declares leaf ^1.2.0, but not the version that installs or what it pulls in",
    ]);
  });

  test("a package.json with no lockfile is named whenever the block prints", async () => {
    const { root, catalog } = await workerWith({
      "api/package-lock.json": JSON.stringify({
        packages: {
          "": { dependencies: { leaf: "1.0.0" } },
          "node_modules/leaf": { version: "1.0.0" },
        },
      }),
      "api/package.json": '{ "dependencies": { "leaf": "1.0.0" } }',
      "web/package.json": '{ "dependencies": { "express": "^4.0.0" } }',
      "web/node_modules/express/package.json": '{ "name": "express" }',
    });
    const lines = formatDepsBlock(await carriersAcross(root, catalog, ["leaf"]));
    expect(lines.filter((l) => l.includes("not read"))).toEqual([
      "  [deps] not read: worker web/package.json: no lockfile, so what it pulls in is unknown",
    ]);
  });

  test("a package.json with no lockfile that does not name it prints nothing on its own", async () => {
    const { root, catalog } = await workerWith({
      "package.json": '{ "dependencies": { "express": "^4.0.0", "leafy": "1.0.0" } }',
    });
    expect(formatDepsBlock(await carriersAcross(root, catalog, ["leaf"]))).toEqual([]);
  });
});

describe("workspace members", () => {
  const expected = [
    ["express", "4.21.1", true, null],
    ["leaf", "1.0.0", true, null],
    ["leaf", "2.0.0", true, null],
    ["qs", "6.13.0", false, "express 4.21.1"],
  ];
  const shape = (deps: { name: string; version: string; direct: boolean; via: string | null }[]) =>
    deps.filter((d) => d.name !== "app").map((d) => [d.name, d.version, d.direct, d.via]);

  test("package-lock.json: a member's own dependencies are direct, and theirs come via them", () => {
    const raw = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "root", workspaces: ["packages/*"], dependencies: { leaf: "1.0.0" } },
        "node_modules/app": { resolved: "packages/app", link: true },
        "node_modules/express": { version: "4.21.1", dependencies: { qs: "6.13.0" } },
        "node_modules/leaf": { version: "1.0.0" },
        "node_modules/qs": { version: "6.13.0" },
        "packages/app": { version: "0.1.0", dependencies: { express: "4.21.1", leaf: "2.0.0" } },
        "packages/app/node_modules/leaf": { version: "2.0.0" },
      },
    });
    expect(shape(parseDeps("package-lock.json", raw).deps)).toEqual(expected);
  });

  test("bun.lock: a member's own dependencies are direct, and theirs come via them", () => {
    const raw = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "root", "dependencies": { "leaf": "1.0.0", }, },
    "packages/app": { "name": "app", "version": "0.1.0", "dependencies": { "express": "4.21.1", "leaf": "2.0.0", }, },
  },
  "packages": {
    "app": ["app@workspace:packages/app"],
    "app/leaf": ["leaf@2.0.0", "", {}, "sha512-b"],
    "express": ["express@4.21.1", "", { "dependencies": { "qs": "6.13.0" } }, "sha512-a"],
    "leaf": ["leaf@1.0.0", "", {}, "sha512-c"],
    "qs": ["qs@6.13.0", "", {}, "sha512-d"],
  },
}
`;
    expect(shape(parseDeps("bun.lock", raw).deps)).toEqual(expected);
  });
});
