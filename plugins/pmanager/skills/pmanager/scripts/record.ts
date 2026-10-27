import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { BundleFile } from "./bundle";
import { check } from "./check";
import { claimBranch } from "./claim";
import { countBySeverity, type Finding, formatFindings } from "./findings";
import { currentBranch, git, hasRemote, pushSetUpstream } from "./git";
import { writeLogEntry } from "./log";
import { applyRender } from "./render";
import { loadPmRepo, PM_DIR } from "./repo";

export type PushState = "pushed" | "no-remote" | "no-claim" | "failed";

export interface RecordOptions {
  slug: string;
  harness: string;
  kind: "spec" | "update";
  message: string;
  today: string;
  staleDays: number;
  files: BundleFile[];
  inRepo: boolean;
}

export interface RecordResult {
  ok: boolean;
  wrote: string[];
  log: string;
  logReused: boolean;
  rendered: string[];
  findings: Finding[];
  errors: number;
  warnings: number;
  commit: { sha: string; branch: string } | null;
  push: PushState | null;
  skipped: string | null;
  pushError?: string;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** An uncommitted log entry for today and this slug, as a docs/pm-relative path. */
async function reusableLog(target: string, opts: RecordOptions): Promise<string | null> {
  const prefix = `${opts.today}-${opts.slug}-`;
  const isEntry = (name: string) =>
    name.startsWith(prefix) && /^[0-9a-f]{6}\.md$/.test(name.slice(prefix.length));
  if (!opts.inRepo) {
    const dir = join(target, PM_DIR, "log");
    const names = await readdir(dir).catch(() => [] as string[]);
    const found = names.filter(isEntry).sort()[0];
    return found ? `log/${found}` : null;
  }
  const status = await git(
    ["status", "--porcelain", "--untracked-files=all", "--", `${PM_DIR}/log`],
    target,
  );
  const found = status.stdout
    .split("\n")
    .filter((l) => l.startsWith("??") || l.startsWith("A"))
    .map((l) => l.slice(3))
    .filter((p) => isEntry(p.slice(`${PM_DIR}/log/`.length)))
    .sort()[0];
  return found ? found.slice(`${PM_DIR}/`.length) : null;
}

/** Write the bundle, log it, render, check, then commit and push only this epic's paths. */
export async function record(target: string, opts: RecordOptions): Promise<RecordResult> {
  const { slug } = opts;
  const pmDir = join(target, PM_DIR);
  let branch = "";
  let claimed = false;
  let remote = false;
  if (opts.inRepo) {
    branch = await currentBranch(target);
    claimed = branch === claimBranch(slug);
    remote = await hasRemote(target);
    if (!claimed && remote) {
      return {
        ok: false,
        wrote: [],
        log: "",
        logReused: false,
        rendered: [],
        findings: [],
        errors: 0,
        warnings: 0,
        commit: null,
        push: null,
        skipped: `${slug} is not claimed; run pm claim ${slug} first`,
      };
    }
  }
  for (const f of opts.files) {
    const path = join(pmDir, f.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, f.content);
  }

  const reused = await reusableLog(target, opts);
  const log =
    reused ??
    relative(
      pmDir,
      await writeLogEntry(pmDir, {
        date: opts.today,
        epic: slug,
        harness: opts.harness,
        kind: opts.kind,
        message: opts.message,
      }),
    );

  const rendered = await applyRender(await loadPmRepo(target));
  const findings = check(await loadPmRepo(target), {
    staleDays: opts.staleDays,
    today: opts.today,
  });
  const { errors, warnings } = countBySeverity(findings);
  const result: RecordResult = {
    ok: true,
    wrote: opts.files.map((f) => f.path),
    log,
    logReused: reused !== null,
    rendered,
    findings,
    errors,
    warnings,
    commit: null,
    push: null,
    skipped: null,
  };
  const skip = (reason: string, ok = true): RecordResult => ({ ...result, ok, skipped: reason });

  if (errors > 0) return skip("check errors", false);
  if (!opts.inRepo) return skip("not a git repository");

  const staged = await git(["diff", "--cached", "--name-only"], target);
  if (staged.stdout.split("\n").some((p) => p !== "" && !p.startsWith(`${PM_DIR}/`))) {
    return skip("staged changes outside docs/pm");
  }

  const candidates = [
    `${PM_DIR}/${slug}`,
    `${PM_DIR}/${log}`,
    `${PM_DIR}/INDEX.md`,
    `${PM_DIR}/pmanager-memo.md`,
    ...rendered.map((p) => relative(target, p)),
  ];
  const paths: string[] = [];
  for (const p of new Set(candidates)) if (await exists(join(target, p))) paths.push(p);
  const add = await git(["add", "--", ...paths], target);
  if (add.code !== 0) return skip(`git add failed: ${add.stderr.trim()}`, false);
  const pending = await git(["diff", "--cached", "--quiet", "--", ...paths], target);
  if (pending.code === 0) return skip("nothing to commit");
  const commit = await git(
    ["commit", "-q", "-m", `docs(pm): ${opts.message}`, "--", ...paths],
    target,
  );
  if (commit.code !== 0) return skip(`git commit failed: ${commit.stderr.trim()}`, false);
  const sha = (await git(["rev-parse", "--short=7", "HEAD"], target)).stdout.trim();
  result.commit = { sha, branch };

  if (!claimed) return { ...result, push: "no-claim" };
  if (!remote) return { ...result, push: "no-remote" };
  const push = await pushSetUpstream(target, claimBranch(slug));
  if (push.code === 0) return { ...result, push: "pushed" };
  return { ...result, ok: false, push: "failed", pushError: push.stderr.trim() };
}

export function formatRecord(r: RecordResult, target: string, slug: string): string {
  const lines = r.wrote.map((p) => `wrote ${PM_DIR}/${p}`);
  if (r.log !== "") lines.push(`log ${PM_DIR}/${r.log}${r.logReused ? " (reused)" : ""}`);
  for (const p of r.rendered) lines.push(`rendered ${p}`);
  const closing = (() => {
    if (!r.commit) {
      return r.skipped === "check errors"
        ? "not committed: check errors; fix the findings, then rerun without --from"
        : `not committed: ${r.skipped}`;
    }
    const head = `committed ${r.commit.sha} on ${r.commit.branch}`;
    if (r.push === "pushed") return `${head}, pushed`;
    if (r.push === "no-remote") return `${head}, unpushed: no remote`;
    if (r.push === "no-claim") return `${head}, unpushed: no claim`;
    return `${head}, push failed: ${r.pushError}\nretry with: git -C ${target} push origin ${claimBranch(slug)}`;
  })();
  return `${lines.join("\n")}\n${formatFindings(r.findings)}${closing}\n`;
}
