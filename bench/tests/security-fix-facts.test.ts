import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BASE_IMAGE, FINDINGS, finding, PARENTS } from "../scenarios/security-fix-facts";

const OVERLAY = join(import.meta.dir, "..", "scenarios", "fixtures", "security-fix");
const read = (p: string) => readFile(join(OVERLAY, p), "utf8");
const bare = (v: string) => v.replace(/^v/, "");

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else out.push(p);
  }
  return out;
}

type Lock = {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};
const npmLock = async () => JSON.parse(await read("storefront/package-lock.json")) as Lock;

/** The version a go.mod requires a module at, with the rest of its line. */
async function goRequire(repo: string, mod: string): Promise<{ version: string; line: string }> {
  const line = (await read(`${repo}/go.mod`)).split("\n").find((l) => l.includes(`${mod} v`)) ?? "";
  const m = line.match(/\sv(\S+)/);
  if (!m?.[1]) throw new Error(`${repo}/go.mod does not require ${mod}`);
  return { version: m[1], line };
}

async function uvVersion(pkg: string): Promise<string> {
  const lock = Bun.TOML.parse(await read("worker/uv.lock")) as {
    package: { name: string; version: string }[];
  };
  const p = lock.package.find((x) => x.name === pkg);
  if (!p) throw new Error(`uv.lock has no ${pkg}`);
  return p.version;
}

describe("security-fix fixture facts", () => {
  test("each finding's fixture version is inside its affected range, except the worker's", async () => {
    const npm = finding("npm");
    const lock = await npmLock();
    expect(
      Bun.semver.satisfies(lock.packages[`node_modules/${npm.pkg}`]?.version ?? "", npm.affected),
    ).toBe(true);
    const go = finding("go");
    for (const repo of ["orders", "webshop"]) {
      expect(Bun.semver.satisfies((await goRequire(repo, go.pkg)).version, go.affected)).toBe(true);
    }
    const py = finding("python");
    expect(Bun.semver.satisfies(await uvVersion(py.pkg), py.affected)).toBe(false);
  });

  test("the worker's declared range still admits an affected version", async () => {
    const py = finding("python");
    const spec = (await read("worker/pyproject.toml")).match(new RegExp(`"${py.pkg}>=([\\d.]+)"`));
    const floor = (spec?.[1] ?? "").split(".").concat(["0", "0"]).slice(0, 3).join(".");
    expect(Bun.semver.satisfies(floor, py.affected)).toBe(true);
  });

  test("the flagged packages are not direct dependencies", async () => {
    const pkg = JSON.parse(await read("storefront/package.json")) as Record<
      string,
      Record<string, string>
    >;
    const npm = finding("npm").pkg;
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain(npm);
    for (const repo of ["orders", "webshop"]) {
      expect((await goRequire(repo, finding("go").pkg)).line.trim().endsWith("// indirect")).toBe(
        true,
      );
    }
  });

  test("each parent is the fixture's direct dependency at its current release", async () => {
    const pkg = JSON.parse(await read("storefront/package.json")) as {
      dependencies: Record<string, string>;
    };
    const lock = await npmLock();
    for (const p of PARENTS) {
      const current = p.versions.find((v) => v.version === p.current);
      if (p.finding === "npm") {
        expect(pkg.dependencies[p.pkg]).toBe(p.current);
        expect(lock.packages[`node_modules/${finding("npm").pkg}`]?.version).toBe(
          current?.resolves ?? "",
        );
      } else {
        expect(`v${(await goRequire(p.repo, p.pkg)).version}`).toBe(p.current);
        expect(`v${(await goRequire(p.repo, finding("go").pkg)).version}`).toBe(
          current?.resolves ?? "",
        );
      }
      const first = p.versions.find((v) => v.version === p.firstFixing);
      expect(first).toBeDefined();
      const resolves = first?.resolves ?? null;
      expect(
        resolves === null || !Bun.semver.satisfies(bare(resolves), finding(p.finding).affected),
      ).toBe(true);
    }
  });

  test("the npm parent's own range excludes the fixed version", async () => {
    const npm = finding("npm");
    const parent = PARENTS.find((p) => p.finding === "npm")?.pkg ?? "";
    const range =
      (await npmLock()).packages[`node_modules/${parent}`]?.dependencies?.[npm.pkg] ?? "";
    expect(range.length > 0).toBe(true);
    expect(Bun.semver.satisfies(npm.fixed, range)).toBe(false);
  });

  test("the base image is storefront's FROM", async () => {
    const lines = (await read("storefront/Dockerfile")).split("\n");
    expect(lines.find((l) => l.startsWith("FROM "))).toBe(`FROM ${BASE_IMAGE.image}`);
  });

  test("no overlay file gives the finding away", async () => {
    const ids = FINDINGS.flatMap((f) => [f.advisory, f.cve]);
    for (const f of await files(OVERLAY)) {
      const text = await readFile(f, "utf8");
      const leaks = [
        ...ids.filter((id) => text.includes(id)),
        ...(text.match(/CVE-|GHSA-|vulnerab|security/gi) ?? []),
      ];
      expect({ file: relative(OVERLAY, f), leaks }).toEqual({
        file: relative(OVERLAY, f),
        leaks: [],
      });
    }
  });

  test("storefront deploys the way webshop does", async () => {
    const release = await read("storefront/.github/workflows/release.yml");
    expect(release).toContain("ghcr.io/pm-example/storefront");
    expect(release).toContain('tags: ["v*"]');
    const version = (JSON.parse(await read("storefront/package.json")) as { version: string })
      .version;
    const k = await read("argocd/workloads/storefront/kustomization.yaml");
    expect(k).toContain("newName: ghcr.io/pm-example/storefront");
    expect(k.match(/newTag:\s*(\S+)/)?.[1]).toBe(version);
  });
});
