import { normalizeRepoUrl } from "./repo-url";

/** A CI job or make target that pushes an image: the release side of a cross-repo link. */
export interface ImageRelease {
  /** registry and repository, no tag; null when the name could not be resolved */
  image: string | null;
  unresolved?: string;
  /** "command": a person runs it (`make release`); "tag"/"branch": CI runs it on that push */
  trigger: { kind: "tag" | "branch" | "command"; pattern: string };
  /** the build context, repo-relative; "" for the root */
  context: string;
  /** the part whose folder holds the context */
  folder: string;
  /** `path:line` */
  source: string;
}

/** A place that sets an image's tag: the rollout side. */
export interface TagSetting {
  image: string;
  key: string;
  /** the part the file is in; "" when none */
  folder: string;
  file: string;
  line: number;
  value: string;
}

const MAX_RELEASES = 50;
const MAX_TAG_SETTINGS = 200;
const WORKLOADS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
  "CronJob",
  "Pod",
]);

/** No tag, no digest, docker.io and library/ made explicit, lowercased. */
export function normalizeImage(ref: string): string {
  const noDigest = ref.split("@")[0] ?? ref;
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  const name = (colon > slash ? noDigest.slice(0, colon) : noDigest).toLowerCase();
  const first = name.split("/")[0] ?? "";
  if (!name.includes("/")) return `docker.io/library/${name}`;
  if (!first.includes(".") && !first.includes(":") && first !== "localhost")
    return `docker.io/${name}`;
  return name;
}

/** Splits `image:tag` where the tag is the part after the last ":" past the last "/". */
function imagePart(ref: string): string {
  const noDigest = ref.split("@")[0] ?? ref;
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  return colon > slash ? noDigest.slice(0, colon) : noDigest;
}

const lineAt = (raw: string, index: number) =>
  index < 0 ? 1 : raw.slice(0, index).split("\n").length;

/** The line of `needle` at or after `anchor`'s first occurrence (from `from`). */
function lineAfter(raw: string, anchor: string, needle: string, from = 0): number {
  const a = raw.indexOf(anchor, from);
  const n = raw.indexOf(needle, a < 0 ? from : a);
  return lineAt(raw, n < 0 ? a : n);
}

interface Vars {
  url?: string;
  registry?: string;
  env: Record<string, string>;
  matrix: Record<string, string[]>;
}

const repoPath = (url?: string) => (url ? normalizeRepoUrl(url).split("/").slice(1).join("/") : "");

/**
 * Every value a reference can take: GitHub expressions for the repo name, env and matrix, shell
 * and GitLab variables. Anything else is unresolved, with the expression that stopped it.
 */
function resolve(ref: string, v: Vars): { values: string[]; unresolved?: string } {
  const path = repoPath(v.url);
  const builtin: Record<string, string | undefined> = {
    "github.repository": path || undefined,
    "github.repository_owner": path ? path.split("/")[0] : undefined,
    "github.event.repository.name": path ? path.split("/").pop() : undefined,
    CI_PROJECT_PATH: path || undefined,
    CI_REGISTRY_IMAGE: v.registry && path ? `${v.registry}/${path}` : undefined,
  };
  let values = [ref];
  for (;;) {
    const sample = values[0] ?? "";
    const m = sample.match(/\$\{\{\s*([\w.-]+)\s*\}\}|\$\{(\w+)\}|\$(\w+)/);
    if (!m) break;
    const expr = (m[1] ?? m[2] ?? m[3]) as string;
    const token = m[0];
    const matrixKey = expr.startsWith("matrix.") ? expr.slice("matrix.".length) : null;
    if (matrixKey && v.matrix[matrixKey]) {
      const choices = v.matrix[matrixKey] as string[];
      values = values.flatMap((x) => choices.map((c) => x.replace(token, c)));
      continue;
    }
    const envKey = expr.startsWith("env.") ? expr.slice("env.".length) : expr;
    const value = builtin[expr] ?? v.env[envKey];
    if (value === undefined) {
      const why =
        expr === "CI_REGISTRY_IMAGE"
          ? "$CI_REGISTRY_IMAGE needs the registry host: set image-registry: in the project file"
          : `${token} is not in this file`;
      return { values: [], unresolved: why };
    }
    values = values.map((x) => x.replace(token, value));
  }
  return { values };
}

function strs(v: unknown): string[] {
  if (typeof v === "string") return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function envOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v))
      if (typeof x === "string" || typeof x === "number") out[k] = String(x);
  }
  return out;
}

// `${{ … }}` holds spaces, so it is masked before a shell line is split into words.
function shellRefs(line: string): string[] {
  const masks: string[] = [];
  const masked = line.replace(/\$\{\{[^}]*\}\}/g, (m) => `@@pmexpr${masks.push(m) - 1}@@`);
  const words = masked.split(/\s+/);
  const unmask = (w: string) => w.replace(/@@pmexpr(\d+)@@/g, (_, i) => masks[Number(i)] ?? "");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "docker") continue;
    if (words[i + 1] === "push" && words[i + 2]) out.push(unmask(words[i + 2] as string));
    const build =
      words[i + 1] === "build" || (words[i + 1] === "buildx" && words[i + 2] === "build");
    if (build && words.includes("--push")) {
      for (let j = i + 2; j < words.length; j++) {
        if ((words[j] === "-t" || words[j] === "--tag") && words[j + 1])
          out.push(unmask(words[j + 1] as string));
      }
    }
  }
  return out;
}

function githubTrigger(doc: Record<string, unknown>): ImageRelease["trigger"] | null {
  const on = doc.on ?? doc.true;
  if (typeof on === "string" || Array.isArray(on)) {
    const evs = strs(on);
    if (evs.includes("release")) return { kind: "tag", pattern: "*" };
    return evs.includes("push") ? { kind: "branch", pattern: "*" } : null;
  }
  if (!on || typeof on !== "object") return null;
  const o = on as Record<string, unknown>;
  const push = o.push as Record<string, unknown> | null | undefined;
  if (push && typeof push === "object") {
    const tags = strs(push.tags);
    if (tags.length > 0) return { kind: "tag", pattern: tags[0] as string };
    const branches = strs(push.branches);
    return { kind: "branch", pattern: branches[0] ?? "*" };
  }
  if ("push" in o) return { kind: "branch", pattern: "*" };
  if ("release" in o) return { kind: "tag", pattern: "*" };
  return null;
}

type Step = {
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: unknown;
  env?: unknown;
};
type GhJob = { steps?: Step[]; env?: unknown; strategy?: { matrix?: Record<string, unknown> } };

function githubReleases(
  doc: Record<string, unknown>,
  raw: string,
  file: string,
  opts: ImageOptions,
  add: (r: ImageRelease) => void,
): void {
  const trigger = githubTrigger(doc);
  if (!trigger) return;
  const jobs = (doc.jobs ?? {}) as Record<string, GhJob>;
  for (const job of Object.values(jobs)) {
    const matrix: Record<string, string[]> = {};
    for (const [k, x] of Object.entries(job?.strategy?.matrix ?? {}))
      if (Array.isArray(x)) matrix[k] = x.map(String);
    const metaImages = new Map<string, string[]>();
    for (const step of job?.steps ?? []) {
      const env = { ...envOf(doc.env), ...envOf(job?.env), ...envOf(step?.env) };
      const vars: Vars = { url: opts.url, registry: opts.registry, env, matrix };
      const uses = step?.uses ?? "";
      const at = (needle: string) => `${file}:${lineAfter(raw, needle, needle)}`;
      if (uses.startsWith("docker/metadata-action")) {
        const imgs = strs(step.with?.images)
          .flatMap((s) => s.split("\n"))
          .map(
            (l) =>
              l
                .trim()
                .replace(/^name=/, "")
                .split(",")[0]
                ?.trim() ?? "",
          )
          .filter(Boolean);
        if (step.id) metaImages.set(step.id, imgs);
        continue;
      }
      if (uses.startsWith("docker/build-push-action")) {
        const push = step.with?.push;
        if (
          !(push === true || push === "true" || (typeof push === "string" && push.includes("${{")))
        )
          continue;
        const tags = String(step.with?.tags ?? "");
        const meta = tags.match(/steps\.([\w-]+)\.outputs\.tags/)?.[1];
        const refs = meta
          ? (metaImages.get(meta) ?? [])
          : tags
              .split(/[\n,]/)
              .map((t) => t.trim())
              .filter(Boolean)
              .map(imagePart);
        const context = String(step.with?.context ?? "")
          .replace(/^\.\/?/, "")
          .replace(/\/$/, "");
        for (const ref of refs) emit(ref, vars, trigger, context, at(uses), opts, add);
        continue;
      }
      for (const line of strs(step?.run).flatMap((r) => r.split("\n"))) {
        for (const ref of shellRefs(line))
          emit(
            imagePart(ref),
            vars,
            trigger,
            "",
            `${file}:${lineAfter(raw, line.trim(), line.trim())}`,
            opts,
            add,
          );
      }
    }
  }
}

const GITLAB_RESERVED = new Set([
  "stages",
  "variables",
  "include",
  "default",
  "workflow",
  "image",
  "services",
  "cache",
  "before_script",
  "after_script",
]);

function gitlabTrigger(job: Record<string, unknown>): ImageRelease["trigger"] {
  const rules = (Array.isArray(job.rules) ? job.rules : []).map((r) =>
    String((r as Record<string, unknown>)?.if ?? ""),
  );
  if (rules.some((r) => r.includes("$CI_COMMIT_TAG"))) return { kind: "tag", pattern: "*" };
  const only = job.only;
  const refs = Array.isArray(only)
    ? strs(only)
    : strs((only as Record<string, unknown> | undefined)?.refs);
  if (refs.includes("tags")) return { kind: "tag", pattern: "*" };
  const branch = rules
    .map((r) => r.match(/\$CI_COMMIT_BRANCH\s*==\s*["']([^"']+)["']/)?.[1])
    .find(Boolean);
  return { kind: "branch", pattern: branch ?? refs[0] ?? "*" };
}

function gitlabReleases(
  doc: Record<string, unknown>,
  raw: string,
  file: string,
  opts: ImageOptions,
  add: (r: ImageRelease) => void,
): void {
  for (const [name, v] of Object.entries(doc)) {
    if (GITLAB_RESERVED.has(name) || name.startsWith(".") || !v || typeof v !== "object") continue;
    const job = v as Record<string, unknown>;
    const env = { ...envOf(doc.variables), ...envOf(job.variables) };
    const vars: Vars = { url: opts.url, registry: opts.registry, env, matrix: {} };
    for (const line of strs(job.script)) {
      for (const ref of shellRefs(line)) {
        emit(
          imagePart(ref),
          vars,
          gitlabTrigger(job),
          "",
          `${file}:${lineAfter(raw, line.trim(), line.trim())}`,
          opts,
          add,
        );
      }
    }
  }
}

function emit(
  ref: string,
  vars: Vars,
  trigger: ImageRelease["trigger"],
  context: string,
  source: string,
  opts: ImageOptions,
  add: (r: ImageRelease) => void,
): void {
  const folder = opts.partOf(context ? `${context}/.` : ".") ?? "";
  const r = resolve(ref, vars);
  if (r.unresolved) {
    add({ image: null, unresolved: r.unresolved, trigger, context, folder, source });
    return;
  }
  for (const value of r.values)
    add({ image: normalizeImage(value), trigger, context, folder, source });
}

/** `make release` that pushes a literal image, like orders': a person runs it. */
function makeReleases(
  recipes: Map<string, string[]> | null,
  file: string,
  opts: ImageOptions,
  add: (r: ImageRelease) => void,
): void {
  for (const line of recipes?.get("release") ?? []) {
    for (const ref of shellRefs(line)) {
      const image = imagePart(ref);
      if (image.includes("$")) continue;
      add({
        image: normalizeImage(image),
        trigger: { kind: "command", pattern: "make release" },
        context: "",
        folder: opts.partOf(file) ?? "",
        source: file,
      });
    }
  }
}

function tagSettings(
  doc: Record<string, unknown>,
  raw: string,
  file: string,
  from: number,
  folder: string,
  add: (t: TagSetting) => void,
): void {
  const kind = typeof doc.kind === "string" ? doc.kind : null;
  if (/(?:^|\/)kustomization\.ya?ml$/.test(file)) {
    for (const e of (Array.isArray(doc.images) ? doc.images : []) as Record<string, unknown>[]) {
      const name = String(e?.newName ?? e?.name ?? "");
      if (!name || e?.newTag === undefined) continue;
      const anchor = `${e?.name ?? name}`;
      add({
        image: normalizeImage(name),
        key: "newTag",
        folder,
        file,
        line: lineAfter(raw, anchor, "newTag:", from),
        value: String(e.newTag),
      });
    }
    return;
  }
  if (kind === "Application") {
    const spec = (doc.spec ?? {}) as Record<string, unknown>;
    for (const src of [spec.source, ...(Array.isArray(spec.sources) ? spec.sources : [])] as Record<
      string,
      unknown
    >[]) {
      const helm = (src?.helm ?? {}) as Record<string, unknown>;
      const params = (Array.isArray(helm.parameters) ? helm.parameters : []) as {
        name?: string;
        value?: unknown;
      }[];
      const repo = params.find((p) => p.name === "image.repository")?.value;
      const tag = params.find((p) => p.name === "image.tag");
      if (typeof repo === "string" && tag) {
        add({
          image: normalizeImage(repo),
          key: "image.tag",
          folder,
          file,
          line: lineAfter(raw, "image.tag", "value:", from),
          value: String(tag.value ?? ""),
        });
      }
      const obj = ((helm.valuesObject ?? {}) as Record<string, unknown>).image as
        | Record<string, unknown>
        | undefined;
      if (typeof obj?.repository === "string" && obj.tag !== undefined) {
        add({
          image: normalizeImage(obj.repository),
          key: "image.tag",
          folder,
          file,
          line: lineAfter(raw, "valuesObject", "tag:", from),
          value: String(obj.tag),
        });
      }
    }
    return;
  }
  if (kind && WORKLOADS.has(kind)) {
    const containers: Record<string, unknown>[] = [];
    const walk = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(walk);
      const o = v as Record<string, unknown>;
      for (const k of ["containers", "initContainers"])
        if (Array.isArray(o[k])) containers.push(...(o[k] as Record<string, unknown>[]));
      for (const [k, x] of Object.entries(o))
        if (k !== "containers" && k !== "initContainers") walk(x);
    };
    walk(doc.spec);
    for (const c of containers) {
      const ref = typeof c?.image === "string" ? c.image : "";
      const name = imagePart(ref);
      if (!ref || name === ref.split("@")[0]) continue;
      add({
        image: normalizeImage(ref),
        key: "image",
        folder,
        file,
        line: lineAfter(raw, `image: ${ref}`, `image: ${ref}`, from),
        value: ref.slice(name.length + 1),
      });
    }
    return;
  }
  if (kind) return;
  // Helm values: any map with a repository and a tag side by side.
  const visit = (v: unknown, prefix: string) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    const o = v as Record<string, unknown>;
    if (
      typeof o.repository === "string" &&
      o.tag !== undefined &&
      (typeof o.tag === "string" || typeof o.tag === "number")
    ) {
      const registry = typeof o.registry === "string" ? `${o.registry}/` : "";
      add({
        image: normalizeImage(`${registry}${o.repository}`),
        key: prefix ? `${prefix}.tag` : "tag",
        folder,
        file,
        line: lineAfter(raw, `repository: ${o.repository}`, "tag:", from),
        value: String(o.tag),
      });
    }
    for (const [k, x] of Object.entries(o)) visit(x, prefix ? `${prefix}.${k}` : k);
  };
  visit(doc, "");
}

export interface ImageOptions {
  url?: string;
  registry?: string;
  /** the part a repo-relative path is in, or null */
  partOf: (file: string) => string | null;
}

/** Releases and tag settings of one checkout, from files `extractProfile` already lists. */
export async function extractImages(
  files: string[],
  read: (f: string) => Promise<string>,
  parseYaml: (raw: string, file: string) => unknown[],
  recipesOf: (file: string) => Promise<Map<string, string[]> | null>,
  opts: ImageOptions,
  notes: string[],
): Promise<{ releases: ImageRelease[]; tagSettings: TagSetting[] }> {
  const releases: ImageRelease[] = [];
  const settings: TagSetting[] = [];
  const addRelease = (r: ImageRelease) => {
    if (
      !releases.some(
        (x) => x.image === r.image && x.source === r.source && x.unresolved === r.unresolved,
      )
    )
      releases.push(r);
  };
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    const raw = await read(f);
    for (const doc of parseYaml(raw, f))
      if (doc && typeof doc === "object")
        githubReleases(doc as Record<string, unknown>, raw, f, opts, addRelease);
  }
  if (files.includes(".gitlab-ci.yml")) {
    const raw = await read(".gitlab-ci.yml");
    for (const doc of parseYaml(raw, ".gitlab-ci.yml"))
      if (doc && typeof doc === "object")
        gitlabReleases(doc as Record<string, unknown>, raw, ".gitlab-ci.yml", opts, addRelease);
  }
  for (const f of files.filter((x) => /(?:^|\/)(?:GNUmakefile|makefile|Makefile)$/.test(x)))
    makeReleases(await recipesOf(f), f, opts, addRelease);
  for (const f of files.filter(
    (x) =>
      /\.ya?ml$/.test(x) && !x.startsWith(".github/") && !/(?:^|\/)\.gitlab-ci\.ya?ml$/.test(x),
  )) {
    const raw = await read(f);
    let from = 0;
    for (const doc of parseYaml(raw, f)) {
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        tagSettings(doc as Record<string, unknown>, raw, f, from, opts.partOf(f) ?? "", (t) =>
          settings.push(t),
        );
      }
      const next = raw.indexOf("\n---", from + 1);
      from = next < 0 ? raw.length : next + 1;
    }
  }
  if (releases.length > MAX_RELEASES)
    notes.push(
      `images: ${releases.length - MAX_RELEASES} releases over the cap of ${MAX_RELEASES}`,
    );
  if (settings.length > MAX_TAG_SETTINGS)
    notes.push(
      `images: ${settings.length - MAX_TAG_SETTINGS} tag settings over the cap of ${MAX_TAG_SETTINGS}`,
    );
  return {
    releases: releases.slice(0, MAX_RELEASES),
    tagSettings: settings.slice(0, MAX_TAG_SETTINGS),
  };
}
