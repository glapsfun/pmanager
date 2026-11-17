import { readFile } from "node:fs/promises";
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
  /** npm-family files pm cannot resolve; `names` when the file names a keyword's package */
  unread: { project: string; file: string; why: string; names: boolean }[];
}

// A lockfile this large is not one a planning run should wait on.
const MAX_BYTES = 10 * 1024 * 1024;
const DEP_FILE =
  /^(?:package-lock\.json|bun\.lock|go\.mod|go\.sum|uv\.lock|poetry\.lock|requirements[\w.-]*\.txt|Dockerfile[\w.-]*)$/;
const JS_LOCK_READ = /^(?:package-lock\.json|bun\.lock)$/;
const JS_LOCK_UNREAD = /^(?:bun\.lockb|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/;
const DECLARED = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/**
 * Line numbers by offset from an index built once per file, and keys found with a forward cursor:
 * entries come in file order, so a 6000-entry lockfile is read once, not once per entry.
 */
function lineFinder(raw: string): {
  at: (index: number) => number;
  find: (needle: string) => number;
} {
  const starts = [0];
  for (let i = raw.indexOf("\n"); i >= 0; i = raw.indexOf("\n", i + 1)) starts.push(i + 1);
  const at = (index: number) => {
    if (index < 0) return 1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  let cursor = 0;
  const find = (needle: string) => {
    let i = raw.indexOf(needle, cursor);
    if (i < 0) i = raw.indexOf(needle);
    if (i >= 0) cursor = i + needle.length;
    return at(i);
  };
  return { at, find };
}

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
  const lines = lineFinder(raw);
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
  const has = (k: string) => k in pkgs;
  const childNames = (e: NpmEntry) => Object.keys({ ...e.dependencies, ...e.optionalDependencies });
  // The root ("") and each workspace member (a key outside node_modules) declare direct dependencies.
  const roots = Object.entries(pkgs).flatMap(([key, e]) =>
    key.includes("node_modules/")
      ? []
      : Object.keys({
          ...e.dependencies,
          ...e.devDependencies,
          ...e.optionalDependencies,
          ...e.peerDependencies,
        }).flatMap((n) => resolveNested(has, key, n) ?? []),
  );
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
    const direct = top === key;
    const via = !direct && top ? `${nameOf(top)} ${pkgs[top]?.version ?? ""}`.trim() : null;
    out.push({
      name,
      version: e.version,
      ecosystem: "npm",
      file,
      line: lines.find(`"${key}"`),
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
  const lines = lineFinder(raw);
  // bun.lock is JSON with trailing commas.
  const lock = JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")) as {
    workspaces?: Record<
      string,
      {
        name?: string;
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
  // The root and each workspace member declare direct dependencies; bun keys a member's own
  // copies under the member's name ("app/leaf"), not its path.
  const roots = Object.entries(lock.workspaces ?? {}).flatMap(([path, w]) =>
    Object.keys({ ...w.dependencies, ...w.devDependencies, ...w.optionalDependencies }).flatMap(
      (n) => resolve(path === "" ? "" : (w.name ?? ""), n) ?? [],
    ),
  );
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
    const direct = top === key;
    const via = !direct && top ? `${spec(top).name} ${spec(top).version}` : null;
    out.push({
      name,
      version,
      ecosystem: "npm",
      file,
      line: lines.find(`"${key}"`),
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
  // replace A => B vX: the build uses vX, so a repo patched this way reads as patched.
  const replaced = new Map<string, string>();
  let block: "require" | "replace" | null = null;
  raw.split("\n").forEach((text, i) => {
    const l = text.replace(/\/\/(?!\s*indirect).*$/, "").trim();
    const opens = l.match(/^(require|replace)\s*\($/);
    if (opens) {
      block = opens[1] as "require" | "replace";
      return;
    }
    if (block && l === ")") {
      block = null;
      return;
    }
    const kind =
      block ?? (l.startsWith("require ") ? "require" : l.startsWith("replace ") ? "replace" : null);
    if (!kind) return;
    const body = block ? l : l.slice(kind.length).trim();
    if (kind === "replace") {
      const m = body.match(/^(\S+)(?:\s+v\S+)?\s*=>\s*\S+\s+(v\S+)/);
      if (m?.[1] && m[2]) replaced.set(m[1], m[2]);
      return;
    }
    const m = body.match(/^(\S+)\s+(v\S+)(.*)$/);
    if (!m?.[1] || !m[2]) return;
    const direct = !/\/\/\s*indirect\b/.test(text);
    out.push({ name: m[1], version: m[2], ecosystem: "go", file, line: i + 1, direct, via: null });
  });
  return out.map((d) => ({ ...d, version: replaced.get(d.name) ?? d.version }));
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
  const lines = lineFinder(raw);
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
      line: lines.at(at),
      direct,
      via,
    });
  }
  return out;
}

function poetryLock(file: string, raw: string, pyproject?: string): Dep[] {
  const lines = lineFinder(raw);
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
        line: lines.at(at),
        direct: directNames.has(PEP503(p.name)),
        via: null,
      },
    ];
  });
}

function requirements(file: string, raw: string): Dep[] {
  const out: Dep[] = [];
  // pip-compile --generate-hashes continues each pin onto --hash lines with a trailing backslash.
  const joined: [string, number][] = [];
  raw.split("\n").forEach((l, i) => {
    const last = joined.at(-1);
    if (last?.[0].endsWith("\\")) last[0] = `${last[0].slice(0, -1)} ${l.trim()}`;
    else joined.push([l, i]);
  });
  joined.forEach(([text, i]) => {
    const l = text.replace(/\s--hash=\S+/g, "");
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

/** Whether a file's text could name a keyword's package (Python names under either separator). */
function mentions(raw: string, keyword: string): boolean {
  const lower = raw.toLowerCase();
  const k = keyword.toLowerCase();
  return (
    lower.includes(k) ||
    lower.includes(k.replace(/[-_.]/g, "-")) ||
    lower.includes(k.replace(/[-_.]/g, "_"))
  );
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
  const all = ls.stdout.split("\n").filter(Boolean);
  const files = all.filter((f) => DEP_FILE.test(basename(f)));
  const hasGoMod = new Set(files.filter((f) => basename(f) === "go.mod").map((f) => dirname(f)));
  for (const f of files) {
    if (basename(f) === "go.sum" && hasGoMod.has(dirname(f))) continue;
    const path = join(checkout, f);
    const raw = await readText(path);
    // A file that never names a keyword carries none of them: it is not parsed at all.
    if (raw === null || !keywords.some((k) => mentions(raw, k))) continue;
    if (raw.length > MAX_BYTES) {
      const mb = Math.round(raw.length / 1024 / 1024);
      r.skipped.push({ project, file: f, why: `over ${MAX_BYTES / 1024 / 1024} MB (${mb} MB)` });
      continue;
    }
    const beside = join(checkout, posix.join(dirname(f), "pyproject.toml"));
    const pyproject =
      basename(f) === "poetry.lock" ? ((await readText(beside)) ?? undefined) : undefined;
    const { deps, skipped } = parseDeps(f, raw, { pyproject });
    if (skipped) r.skipped.push({ project, file: f, why: skipped });
    for (const d of deps)
      if (keywords.some((k) => matchesPackage(k, d))) r.carriers.push({ ...d, project });
  }
  await unreadIn(checkout, project, keywords, all, r);
}

/** The package and range a package.json declares for a keyword, as "name range". */
function declaredIn(raw: string | null, keywords: string[]): string | null {
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (!pkg || typeof pkg !== "object") return null;
  for (const section of DECLARED) {
    const deps = (pkg as Record<string, unknown>)[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps)) {
      const version = String(range);
      if (keywords.some((k) => matchesPackage(k, { name, ecosystem: "npm", version })))
        return `${name} ${version}`;
    }
  }
  return null;
}

/**
 * npm-family files pm cannot resolve, so a repo is never silently "not affected": a lockfile in a
 * format pm does not parse, and a package.json with no lockfile in its directory or above.
 */
async function unreadIn(
  checkout: string,
  project: string,
  keywords: string[],
  files: string[],
  r: CarrierReport,
): Promise<void> {
  const own = files.filter((f) => !f.split("/").includes("node_modules"));
  const lockDirs = (re: RegExp) =>
    new Set(own.filter((f) => re.test(basename(f))).map((f) => dirname(f)));
  const readable = lockDirs(JS_LOCK_READ);
  const unreadable = lockDirs(JS_LOCK_UNREAD);
  const locked = (dir: string): boolean =>
    readable.has(dir) || unreadable.has(dir) || (dir !== "." && locked(dirname(dir)));
  for (const f of own) {
    const name = basename(f);
    if (JS_LOCK_UNREAD.test(name) && !readable.has(dirname(f))) {
      const raw = await readText(join(checkout, f));
      const k = raw === null ? undefined : keywords.find((x) => mentions(raw, x));
      if (k) {
        const why = `pm does not read this format, and it mentions ${k}`;
        r.unread.push({ project, file: f, why, names: true });
      }
    } else if (name === "package.json" && !locked(dirname(f))) {
      const declared = declaredIn(await readText(join(checkout, f)), keywords);
      const why = declared
        ? `no lockfile; it declares ${declared}, but not the version that installs or what it pulls in`
        : "no lockfile, so what it pulls in is unknown";
      r.unread.push({ project, file: f, why, names: declared !== null });
    }
  }
}

/** Every registered project checked out here that carries a keyword's package; read now, never stored. */
export async function carriersAcross(
  root: string,
  catalog: Catalog,
  keywords: string[],
): Promise<CarrierReport> {
  const r: CarrierReport = { carriers: [], unchecked: [], skipped: [], unread: [] };
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

// Each repo keeps lines of its own, so one repo's nested copies never hide another hit repo.
const PER_REPO = 5;

/**
 * The research block: nothing when no repo carries the package and no file that names it was
 * skipped or left unread, so other runs stay as they were. Once it prints, every unread file
 * shows, since a package.json with no lockfile hides what it pulls in.
 */
export function formatDepsBlock(r: CarrierReport, limit = 20): string[] {
  const notes = [
    ...r.skipped.map((s) => `  [deps] skipped: ${s.project} ${s.file}: ${s.why}`),
    ...r.unread.map((u) => `  [deps] not read: ${u.project} ${u.file}: ${u.why}`),
    ...r.unchecked.map((u) => `  [deps] not checked: ${u.project} (${u.availability})`),
  ];
  if (r.carriers.length === 0)
    return r.skipped.length > 0 || r.unread.some((u) => u.names)
      ? ["deps: none found", ...notes]
      : [];
  const byRepo = new Map<string, Carrier[]>();
  for (const c of r.carriers) byRepo.set(c.project, [...(byRepo.get(c.project) ?? []), c]);
  const per = Math.max(PER_REPO, Math.floor(limit / byRepo.size));
  const shown: string[] = [];
  for (const [project, cs] of byRepo) {
    shown.push(...cs.slice(0, per).map(describe));
    if (cs.length > per) shown.push(`  +${cs.length - per} more in ${project}`);
  }
  return ["deps:", ...shown, ...notes];
}

const INSTALL =
  /\b(?:go\s+get|npm\s+(?:i|install|add)|bun\s+add|yarn\s+add|pnpm\s+add|pip3?\s+install|uv\s+(?:add|pip\s+install))\s+/gi;
// "golang.org/x/net v0.23.0 -> v0.36.0", "golang.org/x/net → v0.36.0"
const ARROW_TO =
  /`?([A-Za-z0-9@][\w@./-]*)`?\s+(?:`?v?\d[\w.+-]*`?\s*)?(?:->|→|=>)\s*`?(v?\d[\w.+-]*)/g;
// Settings a task sets "to" a version, not packages: a rollout task's newTag is the common one.
const NOT_PACKAGES = new Set([
  "newtag",
  "tag",
  "image",
  "image.tag",
  "version",
  "chart",
  "appversion",
]);
const BUMP_TO =
  /\b(?:bump|upgrade|update|raise|move|set|pin)\w*\s+(?:the\s+)?`?([A-Za-z0-9@][\w@./-]*)`?\s+(?:(?:dependency|package|module)\s+)?(?:from\s+`?v?[\w.+-]+`?\s+)?to\s+`?(v?\d[\w.+-]*)/gi;

/** `name@version`, `name==version` or a floor `name>=version`; a scoped npm name keeps its @. */
function pinned(token: string): { name: string; version: string } | null {
  const t = token.replace(/^[`'"(]+|[`'"),;.:]+$/g, "");
  const op = t.match(/^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?(?:==|>=|≥|~=)(v?\d[\w.+-]*)$/);
  if (op?.[1] && op[2]) return { name: op[1], version: op[2] };
  const at = t.lastIndexOf("@");
  return at > 0 ? { name: t.slice(0, at), version: t.slice(at + 1) } : null;
}

/** The packages a task moves to a named version: install commands, or "bump X ... to V". */
export function bumpTargets(text: string): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = [];
  const push = (b: { name: string; version: string } | null) => {
    if (b?.name && b.version && !out.some((x) => x.name === b.name && x.version === b.version))
      out.push(b);
  };
  for (const m of text.matchAll(INSTALL)) {
    const rest = text.slice((m.index ?? 0) + m[0].length).split("\n")[0] ?? "";
    for (const word of rest.split(/\s+/)) {
      if (word.startsWith("-")) continue;
      const b = pinned(word);
      if (!b) break;
      push(b);
    }
  }
  for (const re of [BUMP_TO, ARROW_TO]) {
    for (const m of text.matchAll(re))
      push({ name: m[1] as string, version: (m[2] as string).replace(/[.,;:]+$/, "") });
  }
  return out.filter((b) => !NOT_PACKAGES.has(b.name.toLowerCase()));
}
