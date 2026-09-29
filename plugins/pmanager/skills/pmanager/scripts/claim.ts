import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isStale } from "./check";
import {
  getList,
  getString,
  parseDoc,
  type Session,
  sessionOf,
  setFrontmatterKey,
} from "./contract";
import {
  checkoutBranch,
  commitPaths,
  currentBranch,
  deleteLocalBranch,
  fetchOrigin,
  git,
  hasRemote,
  localBranchExists,
  pushSetUpstream,
  readFileAtRef,
  remoteBranchExists,
} from "./git";
import { writeLogEntry } from "./log";
import { PM_DIR } from "./repo";
import { ensureWorktree, movePendingEpic, removeWorktree, worktreeFor } from "./worktree";

export const CLAIM_PREFIX = "pm/";

export function claimBranch(slug: string): string {
  return `${CLAIM_PREFIX}${slug}`;
}

export type ClaimOutcome =
  | { ok: true; branch: string; worktree: string; message: string }
  | {
      ok: false;
      reason: "taken" | "not-stale" | "no-remote" | "no-epic" | "push-failed" | "worktree";
      message: string;
      owner?: Session;
    };

export interface ClaimOptions {
  harness: string;
  takeover: boolean;
  staleDays: number;
  today: string;
  noWorktree?: boolean;
}

function epicRel(slug: string): string {
  return `${PM_DIR}/${slug}/epic.md`;
}

/** Epic metadata as it exists on origin/pm/<slug>, the authoritative claim record. */
export interface RemoteEpic {
  session: Session | null;
  updated: string;
  title: string;
  type: string;
  status: string;
  owner: string;
  repos: string[];
  primaryMetric: string;
}

export async function remoteEpicOf(root: string, slug: string): Promise<RemoteEpic | null> {
  const raw = await readFileAtRef(root, `origin/${claimBranch(slug)}`, epicRel(slug));
  if (raw === null) return null;
  const fm = parseDoc(epicRel(slug), raw).frontmatter;
  return {
    session: sessionOf(fm),
    updated: getString(fm, "updated") ?? "",
    title: getString(fm, "title") ?? slug,
    type: getString(fm, "type") ?? "",
    status: getString(fm, "status") ?? "unknown",
    owner: getString(fm, "owner") ?? "unassigned",
    repos: getList(fm, "repos"),
    primaryMetric: getString(fm, "primary-metric") ?? "",
  };
}

export async function remoteSessionOf(root: string, slug: string): Promise<Session | null> {
  return (await remoteEpicOf(root, slug))?.session ?? null;
}

async function remoteUpdatedOf(root: string, slug: string): Promise<string> {
  return (await remoteEpicOf(root, slug))?.updated ?? "";
}

async function writeSession(
  root: string,
  slug: string,
  session: Session | undefined,
  today: string,
  status?: string,
): Promise<string> {
  const path = join(root, epicRel(slug));
  let raw = await readFile(path, "utf8");
  raw = setFrontmatterKey(
    raw,
    "session",
    session
      ? { harness: session.harness, claimed: session.claimed, branch: session.branch }
      : undefined,
  );
  if (status) raw = setFrontmatterKey(raw, "status", status);
  raw = setFrontmatterKey(raw, "updated", today);
  await writeFile(path, raw);
  return path;
}

async function appendPlanChangelog(
  root: string,
  slug: string,
  date: string,
  change: string,
  why: string,
): Promise<string | null> {
  const path = join(root, PM_DIR, slug, "plan.md");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const idx = raw.indexOf("## Changelog");
  if (idx === -1) return null;
  const rows = raw.slice(idx);
  const lastRow = rows.lastIndexOf("\n|");
  const insertAt = idx + (lastRow === -1 ? rows.length : rows.indexOf("\n", lastRow + 1));
  const out = `${raw.slice(0, insertAt)}\n| ${date} | ${change} | ${why} |${raw.slice(insertAt)}`;
  await writeFile(path, out);
  return path;
}

async function localEpicExists(root: string, slug: string): Promise<boolean> {
  try {
    await readFile(join(root, epicRel(slug)), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function claim(root: string, slug: string, opts: ClaimOptions): Promise<ClaimOutcome> {
  const branch = claimBranch(slug);
  if (!(await hasRemote(root))) {
    return {
      ok: false,
      reason: "no-remote",
      message: "no origin remote; claims need a shared remote",
    };
  }
  await fetchOrigin(root);
  const takenBy = (await remoteBranchExists(root, branch))
    ? ((await remoteSessionOf(root, slug)) ?? { harness: "unknown", claimed: "", branch })
    : null;

  if (takenBy && !opts.takeover) {
    return {
      ok: false,
      reason: "taken",
      owner: takenBy,
      message: `${slug} is owned by ${takenBy.harness} since ${takenBy.claimed || "unknown"} (branch ${branch})`,
    };
  }
  // A fresh claim needs the epic on the current branch. A takeover gets the
  // file from the claimed branch itself, checked below after the checkout.
  if (!takenBy && !(await localEpicExists(root, slug))) {
    return { ok: false, reason: "no-epic", message: `no ${epicRel(slug)} on the current branch` };
  }

  // Refuse a non-stale takeover before creating anything: a refusal must leave no trace.
  const remoteUpdated = takenBy ? await remoteUpdatedOf(root, slug) : "";
  if (takenBy && !isStale(remoteUpdated, opts.today, opts.staleDays)) {
    return {
      ok: false,
      reason: "not-stale",
      owner: takenBy,
      message: `${slug} claim by ${takenBy.harness} is not stale (updated ${remoteUpdated}); takeover refused`,
    };
  }

  const paths: string[] = [];
  const previousBranch = await currentBranch(root);
  let created = false;
  let target = root;
  if (opts.noWorktree) {
    if (previousBranch !== branch) {
      if (await localBranchExists(root, branch)) await checkoutBranch(root, branch, false);
      else {
        await checkoutBranch(root, branch, true, takenBy ? `origin/${branch}` : undefined);
        created = true;
      }
    }
  } else {
    const wt = await ensureWorktree(root, slug, {
      branch,
      startPoint: takenBy ? `origin/${branch}` : undefined,
    });
    if (!wt.ok) return { ok: false, reason: "worktree", message: wt.message };
    target = wt.path;
    created = wt.created;
  }
  const pmDir = join(target, PM_DIR);
  if (takenBy) {
    await git(["pull", "-q", "--ff-only", "origin", branch], target);
    if (!(await localEpicExists(target, slug))) {
      return {
        ok: false,
        reason: "no-epic",
        message: `no ${epicRel(slug)} on ${branch} either; nothing to take over`,
      };
    }
    const planPath = await appendPlanChangelog(
      target,
      slug,
      opts.today,
      `taken over from ${takenBy.harness} by ${opts.harness}`,
      `claim stale since ${remoteUpdated}`,
    );
    if (planPath) paths.push(planPath);
    paths.push(
      await writeLogEntry(pmDir, {
        date: opts.today,
        epic: slug,
        harness: opts.harness,
        kind: "takeover",
        message: `taken over from ${takenBy.harness}`,
      }),
    );
  } else {
    await movePendingEpic(root, target, slug);
    paths.push(
      await writeLogEntry(pmDir, {
        date: opts.today,
        epic: slug,
        harness: opts.harness,
        kind: "claim",
        message: `claimed by ${opts.harness}`,
      }),
    );
  }
  paths.push(
    await writeSession(
      target,
      slug,
      { harness: opts.harness, claimed: opts.today, branch },
      opts.today,
    ),
  );
  await commitPaths(target, paths, `docs(pm): ${takenBy ? "take over" : "claim"} ${slug}`);

  const push = await pushSetUpstream(target, branch);
  if (push.code === 0) {
    return {
      ok: true,
      branch,
      worktree: target,
      message: `${slug} claimed by ${opts.harness} on ${branch}`,
    };
  }

  // The push failed. Only a branch that now exists on the remote means a
  // concurrent claim won; anything else (hook, permissions, network) keeps
  // every local change in place.
  await fetchOrigin(root);
  const concurrent = !takenBy && (await remoteBranchExists(root, branch));
  if (concurrent) {
    const owner = (await remoteSessionOf(root, slug)) ?? {
      harness: "unknown",
      claimed: "",
      branch,
    };
    if (created) {
      if (opts.noWorktree) await checkoutBranch(root, previousBranch, false);
      else await removeWorktree(root, target, {});
      await deleteLocalBranch(root, branch);
      return {
        ok: false,
        reason: "taken",
        owner,
        message: `${slug} was claimed concurrently by ${owner.harness}; local claim branch removed`,
      };
    }
    return {
      ok: false,
      reason: "taken",
      owner,
      message: `${slug} was claimed concurrently by ${owner.harness}; your local claim commit remains on ${branch} (unpushed) — inspect or delete it yourself`,
    };
  }
  return {
    ok: false,
    reason: "push-failed",
    message: `push of ${branch} failed: ${push.stderr.trim()}\nyour claim commit is still on ${branch}; retry with: git push origin ${branch}`,
  };
}

export type ReleaseReason =
  | "no-remote"
  | "no-branch"
  | "unclaimed"
  | "not-owner"
  | "push-failed"
  | "worktree";

export interface ReleaseOutcome {
  ok: boolean;
  message: string;
  reason?: ReleaseReason;
  /** the epic's worktree, for the caller to remove after it has finished writing there */
  worktree?: string | null;
}

export async function release(
  root: string,
  slug: string,
  opts: {
    harness: string;
    today: string;
    force?: boolean;
    noWorktree?: boolean;
    abandon?: boolean;
  },
): Promise<ReleaseOutcome> {
  const branch = claimBranch(slug);
  if (!(await hasRemote(root)))
    return { ok: false, reason: "no-remote", message: "no origin remote" };
  await fetchOrigin(root);
  const wt = opts.noWorktree ? null : await worktreeFor(root, branch);

  const noBranch: ReleaseOutcome = {
    ok: false,
    reason: "no-branch",
    message: `not on ${branch} and no local branch of that name`,
  };
  // No worktree holds the branch, the checkout is not already on it, and no
  // local branch exists to check out or build a worktree from: there is
  // nothing to release, in either mode. This must be decided before an
  // origin-record refusal below, or that refusal's --force hint would lead
  // nowhere.
  let onBranch = false;
  if (!wt) {
    onBranch = (await currentBranch(root)) === branch;
    if (!onBranch && !(await localBranchExists(root, branch))) return noBranch;
  }

  // The remote claim record is authoritative. When origin has it, a refusal
  // must run, and leave no trace, before the checkout is touched or a
  // worktree is created.
  const remote = await remoteEpicOf(root, slug);
  const refuse = (
    owner: Session | null,
    status: string | undefined,
    hasRecord: boolean,
  ): ReleaseOutcome | null => {
    if (opts.abandon && status === "abandoned") {
      return { ok: false, reason: "unclaimed", message: `${slug} is already abandoned` };
    }
    // an unowned epic can still be abandoned: there is no owner to override
    if (owner === null && !(opts.abandon && hasRecord)) {
      return { ok: false, reason: "unclaimed", message: `${slug} is already unclaimed` };
    }
    if (owner !== null && owner.harness !== opts.harness && !opts.force) {
      return {
        ok: false,
        reason: "not-owner",
        message: `${slug} is owned by ${owner.harness} (claimed ${owner.claimed || "unknown"}), not ${opts.harness}; ask that session to release it, use claim --takeover if status shows [stale], or release --force as a deliberate override`,
      };
    }
    return null;
  };
  if (remote !== null) {
    const refusal = refuse(remote.session, remote.status, true);
    if (refusal) return refusal;
  }

  // Reads a branch's own claim record when origin has none for it — never
  // pushed, or pushed and later deleted (a merged PR with branch
  // auto-delete) — and refuses on it exactly as the remote record would.
  const refuseLocal = async (
    raw: string | null,
  ): Promise<{
    owner: Session | null;
    status: string | undefined;
    refusal: ReleaseOutcome | null;
  }> => {
    const local = raw !== null ? parseDoc(epicRel(slug), raw).frontmatter : null;
    const owner = local ? sessionOf(local) : null;
    const status = local ? getString(local, "status") : undefined;
    return { owner, status, refusal: refuse(owner, status, local !== null) };
  };

  // Establish the target: the worktree that already holds the branch, the
  // legacy checkout switch under --no-worktree, or a freshly recreated
  // worktree for a local branch whose worktree was removed. A refusal
  // creates nothing, so a worktree that does not exist yet is only built
  // once the release is known to proceed.
  let target = root;
  let worktree: string | null = null;
  let owner: Session | null;
  let status: string | undefined;
  if (wt) {
    target = wt.path;
    worktree = wt.path;
    if (remote !== null) {
      owner = remote.session;
      status = remote.status;
    } else {
      const raw = (await localEpicExists(target, slug))
        ? await readFile(join(target, epicRel(slug)), "utf8")
        : null;
      const rec = await refuseLocal(raw);
      if (rec.refusal) return rec.refusal;
      owner = rec.owner;
      status = rec.status;
    }
  } else if (opts.noWorktree) {
    if (!onBranch) await checkoutBranch(root, branch, false);
    if (remote !== null) {
      owner = remote.session;
      status = remote.status;
    } else {
      const raw = (await localEpicExists(root, slug))
        ? await readFile(join(root, epicRel(slug)), "utf8")
        : null;
      const rec = await refuseLocal(raw);
      if (rec.refusal) return rec.refusal;
      owner = rec.owner;
      status = rec.status;
    }
  } else {
    // The precheck above already proved this local branch exists.
    if (remote !== null) {
      owner = remote.session;
      status = remote.status;
    } else {
      const raw = await readFileAtRef(root, branch, epicRel(slug));
      const rec = await refuseLocal(raw);
      if (rec.refusal) return rec.refusal;
      owner = rec.owner;
      status = rec.status;
    }
    const created = await ensureWorktree(root, slug, { branch });
    if (!created.ok) return { ok: false, reason: "worktree", message: created.message };
    target = created.path;
    worktree = created.path;
  }
  const overridden = owner !== null && owner.harness !== opts.harness ? owner.harness : null;
  const forced = overridden !== null;
  const paths = [
    await writeSession(target, slug, undefined, opts.today, opts.abandon ? "abandoned" : undefined),
  ];
  if (forced) {
    const planPath = await appendPlanChangelog(
      target,
      slug,
      opts.today,
      `force-released by ${opts.harness}`,
      `claim by ${overridden} overridden`,
    );
    if (planPath) paths.push(planPath);
  }
  paths.push(
    await writeLogEntry(join(target, PM_DIR), {
      date: opts.today,
      epic: slug,
      harness: opts.harness,
      kind: "release",
      message: opts.abandon
        ? forced
          ? `abandoned by ${opts.harness} (forced, was ${overridden})`
          : `abandoned by ${opts.harness}`
        : forced
          ? `force-released by ${opts.harness} (was ${overridden})`
          : `released by ${opts.harness}`,
    }),
  );
  await commitPaths(target, paths, `docs(pm): ${opts.abandon ? "abandon" : "release"} ${slug}`);
  const push = await pushSetUpstream(target, branch);
  if (push.code !== 0) {
    const retry = worktree
      ? `\nthe release commit is in ${worktree}; retry with: git -C ${worktree} push origin ${branch}`
      : "";
    return {
      ok: false,
      reason: "push-failed",
      message: `push failed: ${push.stderr.trim()}${retry}`,
    };
  }
  const base = opts.abandon
    ? `${slug} abandoned; branch ${branch} stays so the slug is not reused`
    : status === "draft"
      ? `${slug} released; its draft stays on ${branch} (release --abandon drops it)`
      : `${slug} released; branch ${branch} still exists until its PR is merged`;
  return { ok: true, message: base, worktree };
}
