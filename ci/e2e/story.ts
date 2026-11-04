import { existsSync } from "node:fs";
import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { shiftDates } from "./dates";
import { pmProcess } from "./pm";
import { gitDateEnv, sh, type TargetName, type Workspace } from "./workspace";

/** The story's last day; the test reads the workspace as of this day. */
export const STORY_END = "2026-11-21";

const STORY = join(import.meta.dir, "fixtures", "multi-repo", "story");

/** [from, to] applied once to a docs/pm file; an empty `from` appends `to`. */
export type Edit = [from: string, to: string];

export type Step = { day: string } & (
  | {
      pm: string[];
      harness: string;
      /** a pm record bundle under fixtures/multi-repo/story/ */
      bundle?: string;
      /** files under docs/pm edited in place, sent to pm record as a bundle */
      edits?: Record<string, Edit[]>;
      /** slug whose captured session id is passed as --session and fills {{session}} */
      session?: string;
    }
  | { commit: TargetName; tree: string; message: string }
  | { git: string[] }
);

const CC = "claude-code";
const HC = "webshop-healthcheck";
const HC_EPIC = `${HC}/epic.md`;
const HC_PLAN = `${HC}/plan.md`;
const HC_T01 = `${HC}/tasks/T01-healthz-endpoint.md`;
const HC_T02 = `${HC}/tasks/T02-probes-and-release.md`;

export const STEPS: Step[] = [
  {
    day: "2026-10-20",
    harness: CC,
    pm: [
      "claim",
      HC,
      "--draft",
      "--title",
      "Health check endpoint for the webshop",
      "--type",
      "feature",
    ],
  },
  {
    day: "2026-10-20",
    harness: CC,
    session: HC,
    pm: ["record", HC, "--kind", "spec", "-m", `spec ${HC}`],
    bundle: `${HC}/01-spec.md`,
  },
  {
    day: "2026-10-20",
    harness: CC,
    session: HC,
    pm: ["record", HC, "--kind", "update", "-m", "add pmanager memo"],
    bundle: `${HC}/02-memo.md`,
  },
  {
    day: "2026-10-23",
    commit: "webshop",
    tree: `${HC}/03-healthz`,
    message: `feat: add /healthz endpoint (${HC} T01)`,
  },
  {
    day: "2026-10-24",
    harness: CC,
    session: HC,
    pm: ["record", HC, "--kind", "update", "-m", "T01 done"],
    edits: {
      [HC_T01]: [
        ["status: todo", "status: done"],
        ["updated: 2026-10-20", "updated: 2026-10-24"],
        ["- [ ] `main.go`", "- [x] `main.go`"],
        ["- [ ] `main_test.go`", "- [x] `main_test.go`"],
        [
          "",
          "\n## History\n\n- 2026-10-24 status todo -> in-progress\n- 2026-10-24 status in-progress -> done\n",
        ],
      ],
      [HC_EPIC]: [
        ["status: approved", "status: in-progress"],
        ["updated: 2026-10-20", "updated: 2026-10-24"],
      ],
      [HC_PLAN]: [
        ["updated: 2026-10-20", "updated: 2026-10-24"],
        ["- [ ] `GET /healthz`", "- [x] `GET /healthz`"],
      ],
    },
  },
  {
    day: "2026-10-29",
    commit: "argocd",
    tree: `${HC}/05-probes`,
    message: `feat(webshop): probes on /healthz and image 1.5.0 (${HC} T02)`,
  },
  {
    day: "2026-10-30",
    harness: CC,
    session: HC,
    pm: ["record", HC, "--kind", "update", "-m", "T02 done; epic done"],
    edits: {
      [HC_T02]: [
        ["status: todo", "status: done"],
        ["updated: 2026-10-20", "updated: 2026-10-30"],
        ["- [ ] `workloads/webshop/deployment.yaml`", "- [x] `workloads/webshop/deployment.yaml`"],
        [
          "- [ ] `workloads/webshop/kustomization.yaml`",
          "- [x] `workloads/webshop/kustomization.yaml`",
        ],
        [
          "",
          "\n## History\n\n- 2026-10-30 status todo -> in-progress\n- 2026-10-30 status in-progress -> done\n",
        ],
      ],
      [HC_EPIC]: [
        ["status: in-progress", "status: done"],
        ["updated: 2026-10-24", "updated: 2026-10-30"],
        [
          "## Outcome\n",
          "## Outcome\n\nHeld for the first release: rolling out 1.5.0 served no 5xx in the ingress logs, against about 40 before. One more release is needed to meet the two-release window. Learned: ship probes in the same commit as the image that serves them.\n",
        ],
      ],
      [HC_PLAN]: [
        ["updated: 2026-10-24", "updated: 2026-10-30"],
        ["- [ ] The webshop Deployment", "- [x] The webshop Deployment"],
        [
          "| 2026-10-20 | Plan created | Epic approved |",
          "| 2026-10-20 | Plan created | Epic approved |\n| 2026-10-30 | All milestones met | T01 and T02 done |",
        ],
      ],
    },
  },
  { day: "2026-10-30", harness: CC, session: HC, pm: ["release", HC] },
  {
    day: "2026-11-02",
    git: [
      "merge",
      "-q",
      "--no-ff",
      `pm/${HC}`,
      "-m",
      `Merge pull request #1 from pm-example/pm/${HC}`,
    ],
  },
  // The branch carried its rendered views, so the render after the merge writes nothing.
  { day: "2026-11-02", harness: CC, pm: ["render"] },
  { day: "2026-11-02", git: ["push", "-q", "origin", "main"] },
  { day: "2026-11-02", git: ["push", "-q", "origin", "--delete", `pm/${HC}`] },
  { day: "2026-11-02", git: ["branch", "-q", "-D", `pm/${HC}`] },
];

function applyEdits(text: string, edits: Edit[], file: string, shift: number): string {
  let out = text;
  for (const [rawFrom, rawTo] of edits) {
    const from = shiftDates(rawFrom, shift);
    const to = shiftDates(rawTo, shift);
    if (from === "") {
      out = `${out.trimEnd()}\n${to}`;
      continue;
    }
    const at = out.indexOf(from);
    // A fixture edit that misses or is ambiguous would silently record the wrong document.
    if (at === -1 || out.indexOf(from, at + 1) !== -1) {
      throw new Error(`edit for ${file} must match exactly once: ${JSON.stringify(from)}`);
    }
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  return out;
}

async function bundleFor(
  ws: Workspace,
  step: Extract<Step, { pm: string[] }>,
  sessionId: string | undefined,
  shift: number,
): Promise<string | undefined> {
  if (step.bundle) {
    const raw = await readFile(join(STORY, step.bundle), "utf8");
    return shiftDates(raw.replaceAll("{{session}}", sessionId ?? "{{session}}"), shift);
  }
  if (!step.edits) return undefined;
  const slug = step.session ?? step.pm[1] ?? "";
  const root = existsSync(ws.worktree(slug)) ? ws.worktree(slug) : ws.manager;
  const parts: string[] = [];
  for (const [file, edits] of Object.entries(step.edits)) {
    const text = await readFile(join(root, "docs", "pm", file), "utf8");
    parts.push(`<!-- pm:file ${file} -->\n${applyEdits(text, edits, file, shift).trimEnd()}\n`);
  }
  return parts.join("");
}

async function commitTree(
  ws: Workspace,
  step: Extract<Step, { commit: TargetName }>,
  env: Record<string, string>,
) {
  const repo = ws.repos[step.commit];
  await cp(join(STORY, step.tree), repo, {
    recursive: true,
    filter: (src) => !src.endsWith(".delete"),
  });
  const deletions = await sh(["find", join(STORY, step.tree), "-name", "*.delete"], repo);
  for (const marker of deletions.split("\n").filter(Boolean)) {
    const rel = marker.slice(join(STORY, step.tree).length + 1, -".delete".length);
    await rm(join(repo, rel), { recursive: true, force: true });
  }
  await sh(["git", "add", "-A"], repo);
  const author = ["-c", "user.name=implementer", "-c", "user.email=implementer@example.invalid"];
  await sh(["git", ...author, "commit", "-q", "-m", step.message], repo, env);
}

async function playStep(
  ws: Workspace,
  step: Step,
  sessions: Record<string, string>,
  shift: number,
): Promise<void> {
  const day = shiftDates(step.day, shift);
  const env = { PM_TODAY: day, ...gitDateEnv(day) };
  if ("commit" in step) return commitTree(ws, step, env);
  if ("git" in step) {
    await sh(["git", ...step.git], ws.manager, env);
    return;
  }
  const args = step.pm.map((a) => shiftDates(a, shift));
  const id = step.session ? sessions[step.session] : undefined;
  if (step.session && !id) throw new Error(`no session captured for ${step.session}`);
  if (id) args.push("--session", id);
  const stdin = await bundleFor(ws, step, id, shift);
  if (stdin !== undefined) args.push("--from", "-");
  const r = await pmProcess(ws.manager, args, { harness: step.harness, stdin, env });
  // record exits 0 with "not committed:" for some refusals; in a scripted story that is a failure.
  if (r.code !== 0 || /^not committed:/m.test(r.stdout)) {
    throw new Error(`exit ${r.code}\n${r.stdout}${r.stderr}`);
  }
  if (args[0] === "claim" && args[1]) {
    const captured = /session: ([0-9a-f]{6})/.exec(r.stdout)?.[1];
    if (captured) sessions[args[1]] = captured;
  }
}

/** Plays STEPS in order; returns each claimed slug's session id. */
export async function playStory(
  ws: Workspace,
  opts: { shiftDays: number },
): Promise<Record<string, string>> {
  const sessions: Record<string, string> = {};
  for (const [i, step] of STEPS.entries()) {
    try {
      await playStep(ws, step, sessions, opts.shiftDays);
    } catch (e) {
      const what =
        "pm" in step
          ? `pm ${step.pm.join(" ")}`
          : "git" in step
            ? `git ${step.git.join(" ")}`
            : `commit ${step.commit}`;
      throw new Error(
        `story step ${i} (${step.day}, ${what}): ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  return sessions;
}
