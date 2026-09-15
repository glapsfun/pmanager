import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isStale } from "./check";
import { getString, parseDoc, type Session, sessionOf, setFrontmatterKey } from "./contract";
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

export const CLAIM_PREFIX = "pm/";

export function claimBranch(slug: string): string {
  return `${CLAIM_PREFIX}${slug}`;
}

export type ClaimOutcome =
  | { ok: true; branch: string; message: string }
  | {
      ok: false;
      reason: "taken" | "not-stale" | "no-remote" | "no-epic" | "push-failed";
      message: string;
      owner?: Session;
    };

export interface ClaimOptions {
  harness: string;
  takeover: boolean;
  staleDays: number;
  today: string;
}

function epicRel(slug: string): string {
  return `${PM_DIR}/${slug}/epic.md`;
}

/** Epic metadata as it exists on origin/pm/<slug>, the authoritative claim record. */
export interface RemoteEpic {
  session: Session | null;
  updated: string;
  title: string;
  status: string;
  owner: string;
}

export async function remoteEpicOf(root: string, slug: string): Promise<RemoteEpic | null> {
  const raw = await readFileAtRef(root, `origin/${claimBranch(slug)}`, epicRel(slug));
  if (raw === null) return null;
  const fm = parseDoc(epicRel(slug), raw).frontmatter;
  return {
    session: sessionOf(fm),
    updated: getString(fm, "updated") ?? "",
    title: getString(fm, "title") ?? slug,
    status: getString(fm, "status") ?? "unknown",
    owner: getString(fm, "owner") ?? "unassigned",
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

  const pmDir = join(root, PM_DIR);
  const paths: string[] = [];
  const previousBranch = await currentBranch(root);
  let created = false;
  if (takenBy) {
    const updated = await remoteUpdatedOf(root, slug);
    if (!isStale(updated, opts.today, opts.staleDays)) {
      return {
        ok: false,
        reason: "not-stale",
        owner: takenBy,
        message: `${slug} claim by ${takenBy.harness} is not stale (updated ${updated}); takeover refused`,
      };
    }
    if (await localBranchExists(root, branch)) {
      await checkoutBranch(root, branch, false);
      await git(["pull", "-q", "--ff-only", "origin", branch], root);
    } else {
      await checkoutBranch(root, branch, true, `origin/${branch}`);
      created = true;
    }
    if (!(await localEpicExists(root, slug))) {
      return {
        ok: false,
        reason: "no-epic",
        message: `no ${epicRel(slug)} on ${branch} either; nothing to take over`,
      };
    }
    const planPath = await appendPlanChangelog(
      root,
      slug,
      opts.today,
      `taken over from ${takenBy.harness} by ${opts.harness}`,
      `claim stale since ${updated}`,
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
    if (previousBranch !== branch) {
      if (await localBranchExists(root, branch)) await checkoutBranch(root, branch, false);
      else {
        await checkoutBranch(root, branch, true);
        created = true;
      }
    }
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
      root,
      slug,
      { harness: opts.harness, claimed: opts.today, branch },
      opts.today,
    ),
  );
  await commitPaths(root, paths, `docs(pm): ${takenBy ? "take over" : "claim"} ${slug}`);

  const push = await pushSetUpstream(root, branch);
  if (push.code === 0) {
    return { ok: true, branch, message: `${slug} claimed by ${opts.harness} on ${branch}` };
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
      await checkoutBranch(root, previousBranch, false);
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

export type ReleaseReason = "no-remote" | "no-branch" | "unclaimed" | "not-owner" | "push-failed";

export interface ReleaseOutcome {
  ok: boolean;
  message: string;
  reason?: ReleaseReason;
}

export async function release(
  root: string,
  slug: string,
  opts: { harness: string; today: string; force?: boolean },
): Promise<ReleaseOutcome> {
  const branch = claimBranch(slug);
  if (!(await hasRemote(root)))
    return { ok: false, reason: "no-remote", message: "no origin remote" };
  await fetchOrigin(root);
  if ((await currentBranch(root)) !== branch) {
    if (await localBranchExists(root, branch)) await checkoutBranch(root, branch, false);
    else {
      return {
        ok: false,
        reason: "no-branch",
        message: `not on ${branch} and no local branch of that name`,
      };
    }
  }
  // The remote claim record is authoritative; fall back to the local file
  // only when the branch has never been pushed.
  const remote = await remoteEpicOf(root, slug);
  const owner =
    remote !== null
      ? remote.session
      : (await localEpicExists(root, slug))
        ? sessionOf(
            parseDoc(epicRel(slug), await readFile(join(root, epicRel(slug)), "utf8")).frontmatter,
          )
        : null;
  if (owner === null) {
    return { ok: false, reason: "unclaimed", message: `${slug} is already unclaimed` };
  }
  if (owner.harness !== opts.harness && !opts.force) {
    return {
      ok: false,
      reason: "not-owner",
      message: `${slug} is owned by ${owner.harness} (claimed ${owner.claimed || "unknown"}), not ${opts.harness}; ask that session to release it, use claim --takeover if status shows [stale], or release --force as a deliberate override`,
    };
  }
  const forced = owner.harness !== opts.harness;
  const paths = [await writeSession(root, slug, undefined, opts.today)];
  if (forced) {
    const planPath = await appendPlanChangelog(
      root,
      slug,
      opts.today,
      `force-released by ${opts.harness}`,
      `claim by ${owner.harness} overridden`,
    );
    if (planPath) paths.push(planPath);
  }
  paths.push(
    await writeLogEntry(join(root, PM_DIR), {
      date: opts.today,
      epic: slug,
      harness: opts.harness,
      kind: "release",
      message: forced
        ? `force-released by ${opts.harness} (was ${owner.harness})`
        : `released by ${opts.harness}`,
    }),
  );
  await commitPaths(root, paths, `docs(pm): release ${slug}`);
  const push = await pushSetUpstream(root, branch);
  return push.code === 0
    ? {
        ok: true,
        message: `${slug} released; branch ${branch} still exists until its PR is merged`,
      }
    : { ok: false, reason: "push-failed", message: `push failed: ${push.stderr.trim()}` };
}
