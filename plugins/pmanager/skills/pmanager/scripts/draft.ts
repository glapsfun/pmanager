import { mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { claimBranch, remoteEpicOf } from "./claim";
import { type FmValue, formatFmValue, getString, type Session, sessionOf } from "./contract";
import {
  commitPaths,
  currentBranch,
  deleteLocalBranch,
  fetchOrigin,
  git,
  gitOk,
  hasRemote,
  listFetchedBranches,
  localBranchExists,
  pushSetUpstream,
  remoteBranchExists,
} from "./git";
import { writeLogEntry } from "./log";
import { type EpicSummary, findLookAlikes, formatLookAlike } from "./lookalike";
import { loadPmRepo, PM_DIR } from "./repo";
import { ensureWorktree, worktreeFor } from "./worktree";

export interface DraftOptions {
  harness: string;
  today: string;
  title: string;
  type: string;
  distinct: boolean;
  noWorktree?: boolean;
}

export type DraftOutcome =
  | { ok: true; branch: string; worktree: string; message: string }
  | {
      ok: false;
      reason: "no-remote" | "taken" | "exists" | "look-alike" | "worktree" | "push-failed";
      message: string;
      owner?: Session;
      lookAlikes?: EpicSummary[];
    };

/** A draft epic: enough frontmatter for status and the look-alike check, framed at Phase 4. */
export function stubEpic(
  slug: string,
  o: { title: string; type: string; today: string; session: Session },
): string {
  const fields: [string, FmValue][] = [
    ["id", slug],
    ["title", o.title],
    ["type", o.type],
    ["status", "draft"],
    ["business-goal", "unknown"],
    ["owner", "unassigned"],
    ["created", o.today],
    ["updated", o.today],
    ["contract", "1"],
    ["primary-metric", "unknown"],
    ["repos", []],
    [
      "session",
      { harness: o.session.harness, claimed: o.session.claimed, branch: o.session.branch },
    ],
  ];
  const fm = fields.map(([k, v]) => formatFmValue(k, v)).join("");
  return `---\n${fm}---\n\n# ${o.title}\n\nResearch in progress; framing happens in Phase 4.\n`;
}

/** Epics on the current branch plus every epic on a fetched origin/pm/* branch, remote wins. */
export async function knownEpics(root: string): Promise<EpicSummary[]> {
  const out = new Map<string, EpicSummary>();
  try {
    for (const e of (await loadPmRepo(root)).epics) {
      if (!e.epic) continue;
      const fm = e.epic.frontmatter;
      out.set(e.slug, {
        slug: e.slug,
        title: getString(fm, "title") ?? e.slug,
        status: getString(fm, "status") ?? "unknown",
        session: sessionOf(fm),
      });
    }
  } catch {
    // cold start: no docs/pm on this branch yet
  }
  const slugs = (await listFetchedBranches(root, "pm/")).map((b) => b.slice("pm/".length));
  const remote = await Promise.all(slugs.map((slug) => remoteEpicOf(root, slug)));
  slugs.forEach((slug, i) => {
    const r = remote[i];
    if (r) out.set(slug, { slug, title: r.title, status: r.status, session: r.session });
  });
  return [...out.values()];
}

async function present(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** A slug whose origin/pm/<slug> exists: name the owner, or say the slug is spent. */
async function takenOnOrigin(root: string, slug: string, branch: string): Promise<DraftOutcome> {
  const remote = await remoteEpicOf(root, slug);
  const owner = remote?.session ?? undefined;
  if (!owner) {
    return {
      ok: false,
      reason: "taken",
      message: `${slug} is already used (status ${remote?.status ?? "unknown"}, branch ${branch}); pick another slug`,
    };
  }
  return {
    ok: false,
    reason: "taken",
    owner,
    message: `${slug} is owned by ${owner.harness} since ${owner.claimed || "unknown"} (branch ${branch})`,
  };
}

/** Exactly what one draftClaim call created, so a cleanup never touches another session's work. */
interface Made {
  branch: boolean;
  worktree: string | null;
  switchedFrom: string | null;
  files: string[];
}

function firstLine(stderr: string): string {
  return stderr.trim().split("\n")[0] ?? "";
}

function reservingHere(slug: string, branch: string): DraftOutcome {
  return {
    ok: false,
    reason: "taken",
    message: `another session in this checkout is reserving ${slug} (${branch} appeared during this draft); check pm status before retrying`,
  };
}

/** Remove empty directories from `dir` up to, not including, `stop`. */
async function pruneEmptyDirs(dir: string, stop: string): Promise<void> {
  for (let d = dir; d.startsWith(`${stop}/`); d = dirname(d)) {
    try {
      await rmdir(d);
    } catch {
      return;
    }
  }
}

async function undo(root: string, branch: string, made: Made): Promise<void> {
  if (made.worktree) {
    // the worktree holds nothing but this call's stub, committed or not
    await git(["worktree", "remove", "--force", made.worktree], root);
    made.worktree = null;
    made.files = [];
  }
  if (made.switchedFrom !== null) {
    // still on the draft branch: keep its files and the branch rather than dirty the checkout
    if ((await git(["checkout", "-q", made.switchedFrom], root)).code !== 0) return;
    made.switchedFrom = null;
  }
  if (made.files.length > 0) {
    await git(["rm", "-q", "--cached", "--force", "--ignore-unmatch", "--", ...made.files], root);
    for (const f of made.files) {
      await rm(f, { force: true });
      await pruneEmptyDirs(dirname(f), root);
    }
    made.files = [];
  }
  if (made.branch && !(await worktreeFor(root, branch))) {
    await deleteLocalBranch(root, branch);
    made.branch = false;
  }
}

/**
 * Create pm/<slug> first: `git branch` is atomic and refuses an existing name, so success
 * proves this call owns the branch and failure proves it does not. `worktree add -b` and
 * `checkout -b` cannot tell which: they may create the branch and then fail.
 */
async function startBranch(
  root: string,
  slug: string,
  branch: string,
  noWorktree: boolean,
  made: Made,
): Promise<DraftOutcome | null> {
  const previous = await currentBranch(root);
  const created = await git(["branch", branch], root);
  if (created.code !== 0) {
    if (/already exists|cannot lock ref/.test(created.stderr)) return reservingHere(slug, branch);
    if (await localBranchExists(root, branch)) return reservingHere(slug, branch);
    return {
      ok: false,
      reason: "worktree",
      message: `could not create ${branch}: ${firstLine(created.stderr)}`,
    };
  }
  made.branch = true;
  if (noWorktree) {
    const co = await git(["checkout", "-q", branch], root);
    if (co.code === 0) {
      made.switchedFrom = previous;
      return null;
    }
    await undo(root, branch, made);
    return {
      ok: false,
      reason: "worktree",
      message: `git checkout ${branch} failed: ${firstLine(co.stderr)}`,
    };
  }
  const wt = await ensureWorktree(root, slug, { branch });
  if (wt.ok && wt.created) {
    made.worktree = wt.path;
    return null;
  }
  if (wt.ok) {
    // someone else's worktree already holds the new branch: theirs now, leave it be
    made.branch = false;
    return reservingHere(slug, branch);
  }
  await undo(root, branch, made);
  return { ok: false, reason: "worktree", message: wt.message };
}

/** origin's tip of the branch after a fresh fetch; null when absent or unknowable. */
async function originTip(root: string, branch: string): Promise<string | null> {
  if (!(await fetchOrigin(root))) return null;
  const r = await git(["rev-parse", "-q", "--verify", `refs/remotes/origin/${branch}`], root);
  return r.code === 0 ? r.stdout.trim() : null;
}

async function takenBy(root: string, slug: string): Promise<Session | undefined> {
  return (await remoteEpicOf(root, slug))?.session ?? undefined;
}

export async function draftClaim(
  root: string,
  slug: string,
  o: DraftOptions,
): Promise<DraftOutcome> {
  const branch = claimBranch(slug);
  if (!(await hasRemote(root))) {
    return {
      ok: false,
      reason: "no-remote",
      message: "no origin remote; claims need a shared remote",
    };
  }
  if (!(await fetchOrigin(root))) {
    return {
      ok: false,
      reason: "no-remote",
      message: "origin is unreachable; claims need a reachable shared remote",
    };
  }
  if (await remoteBranchExists(root, branch)) return takenOnOrigin(root, slug, branch);
  // In a shared checkout another session's unpushed draft shows up only as a local branch.
  if (await localBranchExists(root, branch)) {
    return {
      ok: false,
      reason: "taken",
      message: `a local ${branch} branch exists (another session in this checkout, or an unpushed claim); push or delete it first`,
    };
  }
  if (await present(join(root, PM_DIR, slug))) {
    return {
      ok: false,
      reason: "exists",
      message: `${PM_DIR}/${slug} already exists here; use update mode`,
    };
  }
  if (!o.distinct) {
    const lookAlikes = findLookAlikes(slug, o.title, await knownEpics(root));
    if (lookAlikes.length > 0) {
      return {
        ok: false,
        reason: "look-alike",
        lookAlikes,
        message: [
          `${slug} looks like existing work:`,
          ...lookAlikes.map(formatLookAlike),
          "ask the user; pass --distinct if this is different work",
        ].join("\n"),
      };
    }
  }
  const made: Made = { branch: false, worktree: null, switchedFrom: null, files: [] };
  try {
    const refused = await startBranch(root, slug, branch, o.noWorktree === true, made);
    if (refused) return refused;
    return await writeAndPush(root, slug, branch, o, made);
  } catch (e) {
    await undo(root, branch, made);
    if (await remoteBranchExists(root, branch)) return takenOnOrigin(root, slug, branch);
    if (!made.branch && (await localBranchExists(root, branch))) return reservingHere(slug, branch);
    return {
      ok: false,
      reason: "worktree",
      message: `could not reserve ${slug}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function writeAndPush(
  root: string,
  slug: string,
  branch: string,
  o: DraftOptions,
  made: Made,
): Promise<DraftOutcome> {
  const target = made.worktree ?? root;
  const session: Session = { harness: o.harness, claimed: o.today, branch };
  const epicPath = join(target, PM_DIR, slug, "epic.md");
  await mkdir(dirname(epicPath), { recursive: true });
  made.files.push(epicPath);
  await writeFile(
    epicPath,
    stubEpic(slug, { title: o.title, type: o.type, today: o.today, session }),
  );
  const logPath = await writeLogEntry(join(target, PM_DIR), {
    date: o.today,
    epic: slug,
    harness: o.harness,
    kind: "claim",
    message: `draft claimed by ${o.harness}`,
  });
  made.files.push(logPath);
  await commitPaths(target, [epicPath, logPath], `docs(pm): reserve ${slug}`);
  const commit = (await gitOk(["rev-parse", "HEAD"], target)).trim();
  const reserved: DraftOutcome = {
    ok: true,
    branch,
    worktree: target,
    message: `${slug} reserved as draft by ${o.harness} on ${branch}`,
  };
  const push = await pushSetUpstream(target, branch);
  if (push.code === 0) return reserved;
  // A failed push can still have landed; only origin's tip says who holds the branch.
  const tip = await originTip(root, branch);
  if (tip === commit) return reserved;
  if (tip !== null) {
    await undo(root, branch, made);
    const owner = await takenBy(root, slug);
    return {
      ok: false,
      reason: "taken",
      owner,
      message: `${slug} was reserved concurrently by ${owner?.harness ?? "unknown"}; local draft removed`,
    };
  }
  return {
    ok: false,
    reason: "push-failed",
    message: `push of ${branch} failed: ${push.stderr.trim()}\nyour draft commit is still on ${branch}; retry with: git push origin ${branch}`,
  };
}
