import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { git } from "./git";
import { readLocalRepoMap, repoMapPmDir } from "./handoff";
import { availability, type Catalog, formatAvailability } from "./projects";

export type Ecosystem = "npm" | "go" | "pypi" | "image";

export interface Dep {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  /** repo-relative path */
  file: string;
  line: number;
  direct: boolean;
  /** the direct dependency that pulls this one in, "name version", when the file records it */
  via: string | null;
}

export interface Carrier extends Dep {
  project: string;
}

export interface CarrierReport {
  carriers: Carrier[];
  unchecked: { project: string; availability: string }[];
  skipped: { project: string; file: string; why: string }[];
}

// A lockfile this large is not one a planning run should wait on.
const MAX_BYTES = 10 * 1024 * 1024;
const DEP_FILE =
  /^(?:package-lock\.json|bun\.lock|go\.mod|go\.sum|uv\.lock|poetry\.lock|requirements[\w.-]*\.txt|Dockerfile[\w.-]*)$/;

const lineAt = (raw: string, index: number) =>
  index < 0 ? 1 : raw.slice(0, index).split("\n").length;

/**
 * Shortest chain from a root dependency: breadth-first over `children`, so each node keeps the
 * first direct dependency that reached it.
 */
function chains(roots: string[], children: (node: string) => string[]): Map<string, string> {
  const rootOf = new Map<string, string>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!rootOf.has(r)) {
      rootOf.set(r, r);
      queue.push(r);
    }
  }
  while (queue.length > 0) {
    const node = queue.shift() as string;
    for (const c of children(node)) {
      if (rootOf.has(c)) continue;
      rootOf.set(c, rootOf.get(node) as string);
      queue.push(c);
    }
  }
  return rootOf;
}

/** npm's nested lookup: a child resolves in the closest node_modules above its parent. */
function resolveNested(has: (key: string) => boolean, parent: string, name: string): string | null {
  let base = parent;
  for (;;) {
    const key = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (has(key)) return key;
    if (!base) return null;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut < 0 ? "" : base.slice(0, cut);
  }
}

type NpmEntry = {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function npmLock(file: string, raw: string): Dep[] {
  const lock = JSON.parse(raw) as {
    packages?: Record<
      string,
      NpmEntry & {
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      }
    >;
  };
  const pkgs = lock.packages ?? {};
  const root = pkgs[""] ?? {};
  const rootNames = Object.keys({
    ...root.dependencies,
    ...root.devDependencies,
    ...root.optionalDependencies,
    ...root.peerDependencies,
  });
  const has = (k: string) => k in pkgs;
  const childNames = (e: NpmEntry) => Object.keys({ ...e.dependencies, ...e.optionalDependencies });
  const roots = rootNames.flatMap((n) => resolveNested(has, "", n) ?? []);
  const rootOf = chains(roots, (key) =>
    childNames(pkgs[key] ?? {}).flatMap((n) => resolveNested(has, key, n) ?? []),
  );
  const nameOf = (key: string) =>
    key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  const out: Dep[] = [];
  for (const [key, e] of Object.entries(pkgs)) {
    if (!key.includes("node_modules/") || !e.version) continue;
    const name = nameOf(key);
    const top = rootOf.get(key);
    const direct = top === key && key === `node_modules/${name}`;
    const via = !direct && top ? `${nameOf(top)} ${pkgs[top]?.version ?? ""}`.trim() : null;
    out.push({
      name,
      version: e.version,
      ecosystem: "npm",
      file,
      line: lineAt(raw, raw.indexOf(`"${key}"`)),
      direct,
      via,
    });
  }
  return out.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
}

function bunLock(file: string, raw: string): Dep[] {
  // bun.lock is JSON with trailing commas.
  const lock = JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as {
    workspaces?: Record<
      string,
      {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      }
    >;
    packages?: Record<
      string,
      [
        string,
        string?,
        { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }?,
        ...unknown[],
      ]
    >;
  };
  const pkgs = lock.packages ?? {};
  const ws = lock.workspaces?.[""] ?? {};
  const has = (k: string) => k in pkgs;
  // A child of key K resolves at "K/child" when bun nested it there, else at the top.
  const resolve = (parent: string, name: string): string | null => {
    let base = parent;
    for (;;) {
      const key = base ? `${base}/${name}` : name;
      if (has(key)) return key;
      if (!base) return null;
      const cut = base.lastIndexOf("/");
      base = cut < 0 ? "" : base.slice(0, cut);
    }
  };
  const spec = (key: string) => {
    const id = pkgs[key]?.[0] ?? "";
    const at = id.lastIndexOf("@");
    return at > 0
      ? { name: id.slice(0, at), version: id.slice(at + 1) }
      : { name: id, version: "" };
  };
  const roots = Object.keys({
    ...ws.dependencies,
    ...ws.devDependencies,
    ...ws.optionalDependencies,
  }).flatMap((n) => resolve("", n) ?? []);
  const rootOf = chains(roots, (key) => {
    const meta = pkgs[key]?.[2] ?? {};
    return Object.keys({ ...meta.dependencies, ...meta.optionalDependencies }).flatMap(
      (n) => resolve(key, n) ?? [],
    );
  });
  const out: Dep[] = [];
  for (const key of Object.keys(pkgs)) {
    const { name, version } = spec(key);
    if (!name || !version) continue;
    const top = rootOf.get(key);
    const direct = top === key && key === name;
    const via = !direct && top ? `${spec(top).name} ${spec(top).version}` : null;
    out.push({
      name,
      version,
      ecosystem: "npm",
      file,
      line: lineAt(raw, raw.indexOf(`"${key}"`)),
      direct,
      via,
    });
  }
  return out.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
}

function goMod(file: string, raw: string): Dep[] {
  const out: Dep[] = [];
  let block = false;
  raw.split("\n").forEach((text, i) => {
    const l = text.trim();
    if (/^require\s*\($/.test(l)) {
      block = true;
      return;
    }
    if (block && l === ")") {
      block = false;
      return;
    }
    const body = block ? l : l.startsWith("require ") ? l.slice("require ".length).trim() : null;
    const m = body?.match(/^(\S+)\s+(v\S+)(.*)$/);
    if (!m?.[1] || !m[2]) return;
    const direct = !/\/\/\s*indirect\b/.test(m[3] ?? "");
    out.push({ name: m[1], version: m[2], ecosystem: "go", file, line: i + 1, direct, via: null });
  });
  return out;
}

function goSum(file: string, raw: string): Dep[] {
  const seen = new Set<string>();
  const out: Dep[] = [];
  raw.split("\n").forEach((l, i) => {
    const m = l.match(/^(\S+)\s+(v[^\s/]+)\s/);
    if (!m?.[1] || !m[2] || seen.has(`${m[1]}@${m[2]}`)) return;
    seen.add(`${m[1]}@${m[2]}`);
    out.push({
      name: m[1],
      version: m[2],
      ecosystem: "go",
      file,
      line: i + 1,
      direct: false,
      via: null,
    });
  });
  return out;
}

const PEP503 = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

function uvLock(file: string, raw: string): Dep[] {
  type Pkg = {
    name: string;
    version?: string;
    source?: Record<string, string>;
    dependencies?: { name: string }[];
    "dev-dependencies"?: Record<string, { name: string }[]>;
  };
  const lock = Bun.TOML.parse(raw) as { package?: Pkg[] };
  const pkgs = lock.package ?? [];
  const byName = new Map(pkgs.map((p) => [PEP503(p.name), p]));
  const isProject = (p: Pkg) => p.source?.virtual === "." || p.source?.editable === ".";
  const project = pkgs.find(isProject);
  const deps = (p: Pkg) =>
    [...(p.dependencies ?? []), ...Object.values(p["dev-dependencies"] ?? {}).flat()].map((d) =>
      PEP503(d.name),
    );
  const rootOf = chains(project ? deps(project) : [], (n) =>
    byName.get(n) ? deps(byName.get(n) as Pkg) : [],
  );
  const out: Dep[] = [];
  for (const p of pkgs) {
    if (isProject(p) || !p.version) continue;
    const key = PEP503(p.name);
    const top = rootOf.get(key);
    const direct = top === key;
    const topPkg = top ? byName.get(top) : undefined;
    const via = !direct && topPkg ? `${topPkg.name} ${topPkg.version ?? ""}`.trim() : null;
    const at = raw.search(
      new RegExp(`^name = "${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "m"),
    );
    out.push({
      name: p.name,
      version: p.version,
      ecosystem: "pypi",
      file,
      line: lineAt(raw, at),
      direct,
      via,
    });
  }
  return out;
}

function poetryLock(file: string, raw: string, pyproject?: string): Dep[] {
  const lock = Bun.TOML.parse(raw) as { package?: { name: string; version?: string }[] };
  let directNames = new Set<string>();
  if (pyproject) {
    try {
      const pp = Bun.TOML.parse(pyproject) as {
        tool?: { poetry?: { dependencies?: Record<string, unknown> } };
        project?: { dependencies?: string[] };
      };
      directNames = new Set(
        [
          ...Object.keys(pp.tool?.poetry?.dependencies ?? {}),
          ...(pp.project?.dependencies ?? []).map((d) => d.split(/[\s<>=!~;[(]/)[0] ?? ""),
        ].map(PEP503),
      );
    } catch {
      directNames = new Set();
    }
  }
  return (lock.package ?? []).flatMap((p) => {
    if (!p.version) return [];
    const at = raw.search(
      new RegExp(`^name = "${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "m"),
    );
    return [
      {
        name: p.name,
        version: p.version,
        ecosystem: "pypi" as const,
        file,
        line: lineAt(raw, at),
        direct: directNames.has(PEP503(p.name)),
        via: null,
      },
    ];
  });
}

function requirements(file: string, raw: string): Dep[] {
  const out: Dep[] = [];
  raw.split("\n").forEach((l, i) => {
    const m = l
      .replace(/#.*$/, "")
      .split(";")[0]
      ?.trim()
      .match(/^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*==\s*([^\s,]+)$/);
    if (m?.[1] && m[2])
      out.push({
        name: m[1],
        version: m[2],
        ecosystem: "pypi",
        file,
        line: i + 1,
        direct: true,
        via: null,
      });
  });
  return out;
}

function dockerfile(file: string, raw: string): Dep[] {
  const stages = new Set<string>();
  const out: Dep[] = [];
  raw.split("\n").forEach((l, i) => {
    const m = l.trim().match(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
    if (!m?.[1]) return;
    const ref = m[1];
    if (m[2]) stages.add(m[2].toLowerCase());
    // A stage, scratch, or a reference built from ARGs names no image pm can read.
    if (stages.has(ref.toLowerCase()) && !m[2]) return;
    if (ref === "scratch" || ref.includes("$")) return;
    const [noDigest = ref, digest] = ref.split("@");
    const colon = noDigest.lastIndexOf(":");
    const tagged = colon > noDigest.lastIndexOf("/");
    const name = tagged ? noDigest.slice(0, colon) : noDigest;
    const version = tagged ? noDigest.slice(colon + 1) : (digest ?? "latest");
    out.push({ name, version, ecosystem: "image", file, line: i + 1, direct: true, via: null });
  });
  return out;
}

/** Every dependency one file records; a file pm cannot parse is skipped with why, never thrown. */
export function parseDeps(
  file: string,
  raw: string,
  context: { pyproject?: string } = {},
): { deps: Dep[]; skipped?: string } {
  const name = basename(file);
  try {
    if (name === "package-lock.json") return { deps: npmLock(file, raw) };
    if (name === "bun.lock") return { deps: bunLock(file, raw) };
    if (name === "go.mod") return { deps: goMod(file, raw) };
    if (name === "go.sum") return { deps: goSum(file, raw) };
    if (name === "uv.lock") return { deps: uvLock(file, raw) };
    if (name === "poetry.lock") return { deps: poetryLock(file, raw, context.pyproject) };
    if (/^requirements[\w.-]*\.txt$/.test(name)) return { deps: requirements(file, raw) };
    if (/^Dockerfile/.test(name)) return { deps: dockerfile(file, raw) };
    return { deps: [] };
  } catch (e) {
    return { deps: [], skipped: `invalid ${name}: ${(e as Error).message.split("\n")[0]}` };
  }
}

/**
 * Exact names, ignoring case. A Go module also matches a keyword with a slash that ends its
 * path ("x/net" for golang.org/x/net, never "net"); an image also matches "name:tag".
 */
export function matchesPackage(
  keyword: string,
  dep: Pick<Dep, "name" | "ecosystem" | "version">,
): boolean {
  const k = keyword.toLowerCase();
  const n = dep.name.toLowerCase();
  if (k === n) return true;
  if (dep.ecosystem === "go" && k.includes("/") && n.endsWith(`/${k}`)) return true;
  if (dep.ecosystem === "pypi" && PEP503(k) === PEP503(n)) return true;
  return dep.ecosystem === "image" && k === `${n}:${dep.version.toLowerCase()}`;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PEP440 = /^\d+(?:\.\d+)*$/;

/** Ordering within one ecosystem; null when either side is not a version pm can order. */
export function compareVersions(eco: Ecosystem, a: string, b: string): number | null {
  if (eco === "image") return null;
  const x = a.replace(/^v/, "");
  const y = b.replace(/^v/, "");
  if (eco === "pypi") {
    if (!PEP440.test(x) || !PEP440.test(y)) return null;
    const xs = x.split(".").map(Number);
    const ys = y.split(".").map(Number);
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const d = (xs[i] ?? 0) - (ys[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  if (!SEMVER.test(x) || !SEMVER.test(y)) return null;
  return Bun.semver.order(x, y);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** The dependency files of one checkout that name a keyword. */
async function carriersIn(
  checkout: string,
  project: string,
  keywords: string[],
  r: CarrierReport,
): Promise<void> {
  const ls = await git(["ls-files"], checkout);
  if (ls.code !== 0) return;
  const files = ls.stdout.split("\n").filter((f) => DEP_FILE.test(basename(f)));
  const hasGoMod = new Set(files.filter((f) => basename(f) === "go.mod").map((f) => dirname(f)));
  for (const f of files) {
    if (basename(f) === "go.sum" && hasGoMod.has(dirname(f))) continue;
    const path = join(checkout, f);
    const size = await sizeOf(path);
    if (size > MAX_BYTES) {
      r.skipped.push({
        project,
        file: f,
        why: `over ${MAX_BYTES / 1024 / 1024} MB (${Math.round(size / 1024 / 1024)} MB)`,
      });
      continue;
    }
    const raw = await readText(path);
    if (raw === null) continue;
    const beside = join(checkout, posix.join(dirname(f), "pyproject.toml"));
    const pyproject =
      basename(f) === "poetry.lock" ? ((await readText(beside)) ?? undefined) : undefined;
    const { deps, skipped } = parseDeps(f, raw, { pyproject });
    if (skipped) r.skipped.push({ project, file: f, why: skipped });
    for (const d of deps)
      if (keywords.some((k) => matchesPackage(k, d))) r.carriers.push({ ...d, project });
  }
}

/** Every registered project checked out here that carries a keyword's package; read now, never stored. */
export async function carriersAcross(
  root: string,
  catalog: Catalog,
  keywords: string[],
): Promise<CarrierReport> {
  const r: CarrierReport = { carriers: [], unchecked: [], skipped: [] };
  if (keywords.length === 0 || catalog.projects.length === 0) return r;
  const map = await readLocalRepoMap(await repoMapPmDir(root));
  for (const p of catalog.projects) {
    const a = await availability(p, map);
    if (a.state !== "available") {
      r.unchecked.push({ project: p.id, availability: formatAvailability(a) });
      continue;
    }
    await carriersIn(a.path, p.id, keywords, r);
  }
  return r;
}

function describe(c: Carrier): string {
  const how = c.direct ? "direct" : c.via ? `via ${c.via}` : "indirect";
  return `  [${c.project} ${c.file}:${c.line}] ${c.name} ${c.version} ${how}`;
}

/** The research block: nothing when no repo carries the package, so other runs stay as they were. */
export function formatDepsBlock(r: CarrierReport, limit = 20): string[] {
  if (r.carriers.length === 0) return [];
  const shown = r.carriers.slice(0, limit).map(describe);
  const more = r.carriers.length > limit ? [`  +${r.carriers.length - limit} more`] : [];
  return [
    "deps:",
    ...shown,
    ...more,
    ...r.skipped.map((s) => `  [deps] skipped: ${s.project} ${s.file}: ${s.why}`),
    ...r.unchecked.map((u) => `  [deps] not checked: ${u.project} (${u.availability})`),
  ];
}
