import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import SCOPES from "../commit-scopes.json";
import type { Check } from "../gate";
import { capture } from "../proc";

export const TYPES: readonly string[] = [
  "feat",
  "fix",
  "docs",
  "chore",
  "test",
  "refactor",
  "perf",
  "build",
  "ci",
  "revert",
];

const SCISSORS = "# ------------------------ >8 ------------------------";
const HEADER = /^([A-Za-z]+)(?:\(([^)]*)\))?!?:/;
const AUTOSQUASH = /^(fixup|squash|amend)! /;

/** First non-blank, non-comment line of a commit message, ignoring everything after the scissors line. */
export function subjectOf(message: string): string {
  for (const line of message.split("\n")) {
    if (line.startsWith(SCISSORS)) return "";
    if (line.trim() === "" || line.startsWith("#")) continue;
    return line.trimEnd();
  }
  return "";
}

/** Why a subject breaks the `type(scope): message` format, or null when it is fine. Autosquash subjects pass only when allowed. */
export function subjectProblem(
  subject: string,
  scopes: readonly string[],
  allowAutosquash = false,
): string | null {
  if (subject.trim() === "") return "empty subject";
  if (AUTOSQUASH.test(subject)) {
    return allowAutosquash
      ? null
      : "fixup!, squash! and amend! commits must be squashed before merge";
  }
  if (subject.startsWith("Merge ") || subject.startsWith('Revert "')) return null;
  const m = HEADER.exec(subject);
  if (!m) return "expected type(scope): message";
  const [head, type, scope] = m;
  if (!TYPES.includes(type as string)) return `unknown type ${type}`;
  if (scope !== undefined && !scopes.includes(scope)) {
    return `scope ${scope} not allowed (${scopes.join(", ")})`;
  }
  const rest = subject.slice(head.length);
  if (!rest.startsWith(" ")) return "expected type(scope): message";
  if (rest.trim() === "") return "empty message";
  return null;
}

/** commit-msg hook check: validates the subject in the file given as the first argument. */
export const commitMsgCheck: Check = async (ctx) => {
  const file = ctx.args[0];
  if (!file) {
    console.error("commit-msg: missing message file argument");
    return false;
  }
  const subject = subjectOf(readFileSync(resolve(process.cwd(), file), "utf8"));
  const problem = subjectProblem(subject, SCOPES, true);
  if (problem) console.error(`commit-msg: ${problem}: ${subject}`);
  return problem === null;
};

/** Validates every commit subject in a `<base>..<head>` range of the current repo. */
export const commitsCheck: Check = async (ctx) => {
  const range = ctx.args[0];
  if (!range) {
    console.error("commits: missing <base>..<head> range");
    return false;
  }
  const log = await capture(["git", "log", "--format=%h%x09%s", range], process.cwd());
  if (log.code !== 0) {
    console.error(`commits: git log failed: ${log.stderr.trim()}`);
    return false;
  }
  let ok = true;
  for (const line of log.stdout.split("\n").filter(Boolean)) {
    const [sha, ...rest] = line.split("\t");
    const subject = rest.join("\t");
    const problem = subjectProblem(subject, SCOPES);
    if (problem) {
      console.error(`${sha} ${subject}: ${problem}`);
      ok = false;
    }
  }
  return ok;
};
