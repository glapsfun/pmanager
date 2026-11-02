import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Ctx } from "./context";
import { readState } from "./state";

export type Need = "prepare" | "publish" | "baseline" | "abandon";

const firstLine = (s: string) => s.split("\n")[0]?.trim() ?? "";

/** Names of refs on origin matching a pattern, peeled duplicates dropped. */
async function remoteRefs(ctx: Ctx, kind: "--heads" | "--tags", pattern: string) {
  const out = await ctx.git.out(["ls-remote", kind, "origin", pattern]);
  const names = out
    .split("\n")
    .filter(Boolean)
    .map((l) =>
      (l.split("\t")[1] ?? "").replace(/^refs\/(heads|tags)\//, "").replace(/\^\{\}$/, ""),
    );
  return [...new Set(names)];
}

async function dirtyBlocker(ctx: Ctx): Promise<string[]> {
  const dirty = await ctx.git.dirty();
  if (dirty.length === 0) return [];
  return [`working tree has changes: commit, stash or remove them first:\n${dirty.join("\n")}`];
}

async function manifestBlocker(ctx: Ctx): Promise<string[]> {
  const versions = await Promise.all(
    ctx.cfg.manifests.map(
      async (m) =>
        (JSON.parse(await readFile(join(ctx.cfg.root, m), "utf8")) as { version?: string }).version,
    ),
  );
  return new Set(versions).size > 1 ? [`manifest versions differ: ${versions.join(" vs ")}`] : [];
}

async function competitorBlockers(ctx: Ctx): Promise<string[]> {
  const out: string[] = [];
  const s = await readState(ctx.cfg);
  if (s && s.phase !== "published" && s.phase !== "published-verify-failed") {
    out.push(`another release is in progress: v${s.version} (${s.phase}); abandon it first`);
  }
  // Prepare clears the state, which is the only record that this verify is still owed.
  if (s?.phase === "published" && s.verify.length === 0) {
    out.push(`v${s.version} is published but verify has not run: run verify first`);
  }
  for (const pr of await ctx.gh.openReleasePrs()) {
    out.push(
      `another release is in progress: PR #${pr.number} from ${pr.headRefName}; abandon it where it was prepared, or close it on GitHub if nobody needs it`,
    );
  }
  const tags = new Set(await remoteRefs(ctx, "--tags", "v*"));
  const local = await ctx.git.out(["branch", "--list", "release/v*", "--format=%(refname:short)"]);
  for (const branch of local.split("\n").filter(Boolean)) {
    if (tags.has(branch.slice("release/".length)) || branch === s?.branch) continue;
    out.push(
      `local branch ${branch} exists without a release; delete it with git branch -D ${branch} if nobody needs it`,
    );
  }
  for (const branch of await remoteRefs(ctx, "--heads", "release/v*")) {
    // A branch left behind by a published release is history, not a competitor.
    if (tags.has(branch.slice("release/".length))) continue;
    out.push(
      `another release is in progress: branch ${branch} on origin; abandon it where it was prepared, or delete it on GitHub if nobody needs it`,
    );
  }
  return out;
}

/** Blockers for the step, in plain sentences; empty when it may go ahead. */
export async function preflight(need: Need, ctx: Ctx, version?: string): Promise<string[]> {
  const origin = await ctx.git.out(["remote", "get-url", "origin"]).catch(() => "");
  if (!ctx.cfg.originPattern.test(origin)) {
    return [
      origin ? `origin is ${origin}, not ${ctx.cfg.slug}` : "this checkout has no origin remote",
    ];
  }
  const name = await ctx.git.out(["config", "user.name"]).catch(() => "");
  let login: string;
  try {
    login = await ctx.gh.login();
  } catch (e) {
    return [`gh is not installed or not logged in: ${firstLine(String((e as Error).message))}`];
  }
  if (login !== name) {
    return [`gh is logged in as ${login}, git user is ${name}: run gh auth switch --user ${name}`];
  }
  if (!(await ctx.git.ok(["fetch", "-q", "origin", "--tags"]))) {
    return ["git fetch origin failed; check the network and your access"];
  }
  if (need === "prepare") {
    return [
      ...(await dirtyBlocker(ctx)),
      ...(await manifestBlocker(ctx)),
      ...(await competitorBlockers(ctx)),
    ];
  }
  const out: string[] = [];
  if (need === "publish" || need === "baseline") {
    if (!(await ctx.gh.tagRulesetOk())) {
      out.push("no active tag ruleset protects v* tags from deletion and update");
    }
  }
  if (need === "publish") out.push(...(await dirtyBlocker(ctx)));
  if (need === "baseline") {
    const others = (await remoteRefs(ctx, "--tags", "v*")).filter((t) => t !== `v${version}`);
    if (others.length > 0) {
      out.push(
        `origin already has release tags (${others.join(", ")}): baseline is only for the first release`,
      );
    }
  }
  return out;
}
