import { TYPES } from "../../../../ci/checks/commit-msg";
import type { Config } from "./config";
import type { Git } from "./git";
import { bumpFor, bumpVersion, highestTag, type Version } from "./semver";

export interface Change {
  sha: string;
  subject: string;
  type: string;
  breaking: boolean;
  pr: number | null;
}

const HEADER = /^([A-Za-z]+)(?:\([^)]*\))?(!)?:\s*/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const RELEASE_COMMIT = /^chore\(release\): v/;
const PR_MERGE = /^Merge pull request #(\d+)/;

export function parseSubject(subject: string, body: string): { type: string; breaking: boolean } {
  const m = HEADER.exec(subject);
  const type = m?.[1]?.toLowerCase();
  return {
    type: type && TYPES.includes(type) ? type : "other",
    breaking: m?.[2] === "!" || BREAKING_FOOTER.test(body),
  };
}

export async function previousRelease(
  git: Git,
  cfg: Config,
): Promise<{ tag: string; version: Version } | null> {
  const tags = await git.out(["tag", "--merged", `origin/${cfg.base}`, "--list", "v*"]);
  return highestTag(tags.split("\n").filter(Boolean));
}

/** The PR whose merge brought sha into main: the first merge after it whose first parent lacks it. */
async function prFor(git: Git, cfg: Config, sha: string): Promise<number | null> {
  const merges = await git.out([
    "rev-list",
    "--merges",
    "--ancestry-path",
    "--reverse",
    `${sha}..origin/${cfg.base}`,
  ]);
  for (const merge of merges.split("\n").filter(Boolean)) {
    if (await git.ok(["merge-base", "--is-ancestor", sha, `${merge}^1`])) continue;
    const m = PR_MERGE.exec(await git.out(["log", "-1", "--format=%s", merge]));
    return m ? Number(m[1]) : null;
  }
  return null;
}

export async function shippedChanges(git: Git, cfg: Config, since: string): Promise<Change[]> {
  const log = await git.out([
    "log",
    "--no-merges",
    "--reverse",
    "--format=%H%x1f%s%x1f%b%x1e",
    `${since}..origin/${cfg.base}`,
    "--",
    ...cfg.shipped,
  ]);
  const out: Change[] = [];
  for (const record of log.split("\x1e")) {
    const [sha, subject, body = ""] = record.trim().split("\x1f");
    if (!sha || subject === undefined || RELEASE_COMMIT.test(subject)) continue;
    out.push({ sha, subject, ...parseSubject(subject, body), pr: await prFor(git, cfg, sha) });
  }
  return out;
}

export function proposeVersion(prev: Version, changes: Change[]): Version {
  const kinds = {
    breaking: changes.some((c) => c.breaking),
    feature: changes.some((c) => c.type === "feat"),
  };
  return bumpVersion(prev, bumpFor(prev, kinds));
}

function section(c: Change): string {
  if (c.breaking) return "Breaking";
  if (c.type === "feat") return "Added";
  if (c.type === "fix" || c.type === "perf") return "Fixed";
  return "Other";
}

const SECTIONS = ["Breaking", "Added", "Fixed", "Other"];

export function draftNotes(changes: Change[]): string {
  const parts: string[] = [];
  for (const name of SECTIONS) {
    const lines = changes
      .filter((c) => section(c) === name)
      .map((c) => {
        const cite = c.pr !== null ? `#${c.pr}` : c.sha.slice(0, 7);
        return `- ${c.subject.replace(HEADER, "")} (${cite})`;
      });
    if (lines.length > 0) parts.push(`## ${name}\n\n${lines.join("\n")}\n`);
  }
  if (changes.some((c) => c.breaking)) parts.push("## Migration\n\n- TODO: what users must do\n");
  return parts.join("\n");
}

const CITATION = /#\d+|\b[0-9a-f]{7,40}\b/;

/** Why the notes are not ready to publish; Migration steps need no citation. */
export function notesProblems(notes: string): string[] {
  if (notes.trim() === "") return ["notes are empty"];
  const out: string[] = [];
  let migration = false;
  for (const line of notes.split("\n")) {
    if (line.startsWith("## ")) migration = line.trim() === "## Migration";
    if (line.includes("TODO")) {
      out.push(`notes still contain a TODO: ${line}`);
      continue;
    }
    if (!migration && /^\s*[-*] /.test(line) && !CITATION.test(line)) {
      out.push(`notes line has no PR or commit citation: ${line}`);
    }
  }
  return out;
}
