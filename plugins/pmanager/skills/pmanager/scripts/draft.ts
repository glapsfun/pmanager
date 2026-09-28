import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { claimBranch, remoteEpicOf } from "./claim";
import { type FmValue, formatFmValue, getString, type Session, sessionOf } from "./contract";
import {
  checkoutBranch,
  commitPaths,
  currentBranch,
  deleteLocalBranch,
  fetchOrigin,
  hasRemote,
  listFetchedBranches,
  localBranchExists,
  pushSetUpstream,
  remoteBranchExists,
} from "./git";
import { writeLogEntry } from "./log";
import { type EpicSummary, findLookAlikes, formatLookAlike } from "./lookalike";
import { loadPmRepo, PM_DIR } from "./repo";
import { ensureWorktree, removeWorktree } from "./worktree";

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
  for (const branch of await listFetchedBranches(root, "pm/")) {
    const slug = branch.slice("pm/".length);
    const r = await remoteEpicOf(root, slug);
    if (r) out.set(slug, { slug, title: r.title, status: r.status, session: r.session });
  }
  return [...out.values()];
}

async function present(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
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
  await fetchOrigin(root);
  if (await remoteBranchExists(root, branch)) {
    const owner = await takenBy(root, slug);
    return {
      ok: false,
      reason: "taken",
      owner,
      message: `${slug} is owned by ${owner?.harness ?? "unknown"} since ${owner?.claimed || "unknown"} (branch ${branch})`,
    };
  }
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
  let target = root;
  const previous = await currentBranch(root);
  if (o.noWorktree) await checkoutBranch(root, branch, true);
  else {
    const wt = await ensureWorktree(root, slug, { branch });
    if (!wt.ok) return { ok: false, reason: "worktree", message: wt.message };
    target = wt.path;
  }
  const session: Session = { harness: o.harness, claimed: o.today, branch };
  const epicPath = join(target, PM_DIR, slug, "epic.md");
  await mkdir(dirname(epicPath), { recursive: true });
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
  await commitPaths(target, [epicPath, logPath], `docs(pm): reserve ${slug}`);
  const push = await pushSetUpstream(target, branch);
  if (push.code === 0) {
    return {
      ok: true,
      branch,
      worktree: target,
      message: `${slug} reserved as draft by ${o.harness} on ${branch}`,
    };
  }
  await fetchOrigin(root);
  if (await remoteBranchExists(root, branch)) {
    const owner = await takenBy(root, slug);
    if (o.noWorktree) await checkoutBranch(root, previous, false);
    else await removeWorktree(root, target, {});
    await deleteLocalBranch(root, branch);
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
