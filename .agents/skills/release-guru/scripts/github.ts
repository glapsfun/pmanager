import { capture } from "../../../../ci/proc";
import type { Run } from "./git";

export interface CheckState {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface PullRequest {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefName: string;
  headRefOid: string;
  mergeCommit: string | null;
  mergeStateStatus: string;
  checks: CheckState[];
  url: string;
}

export interface Release {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  latest: boolean;
  body: string;
  url: string;
}

export interface GitHub {
  login(): Promise<string>;
  tagRulesetOk(): Promise<boolean>;
  findPr(head: string): Promise<PullRequest | null>;
  openReleasePrs(): Promise<PullRequest[]>;
  createPr(head: string, base: string, title: string, bodyFile: string): Promise<number>;
  prView(n: number): Promise<PullRequest>;
  mergePr(n: number, headCommit: string): Promise<void>;
  closePr(n: number, comment: string): Promise<void>;
  release(tag: string): Promise<Release | null>;
  createRelease(tag: string, title: string, notesFile: string): Promise<void>;
  commitChecks(sha: string): Promise<CheckState[]>;
}

const LIST_FIELDS = "number,state,headRefName,headRefOid,url";
const VIEW_FIELDS =
  "number,state,headRefName,headRefOid,mergeCommit,mergeStateStatus,statusCheckRollup,url";
const NOT_FOUND = /Not Found|HTTP 404/;

class GhError extends Error {}

interface RollupEntry {
  __typename?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  context?: string;
  state?: string;
}

function toCheck(e: RollupEntry): CheckState {
  if (e.__typename === "StatusContext") {
    const state = (e.state ?? "").toUpperCase();
    const pending = state === "PENDING" || state === "EXPECTED";
    return {
      name: e.context ?? "",
      status: pending ? "IN_PROGRESS" : "COMPLETED",
      conclusion: pending ? null : state,
    };
  }
  return {
    name: e.name ?? "",
    status: (e.status ?? "").toUpperCase(),
    conclusion: e.conclusion ? e.conclusion.toUpperCase() : null,
  };
}

export function ghGitHub(slug: string, run: Run = capture): GitHub {
  const gh = async (args: string[]) => {
    const r = await run(["gh", ...args], process.cwd());
    if (r.code !== 0) {
      throw new GhError(`gh ${args.slice(0, 2).join(" ")}: ${(r.stderr || r.stdout).trim()}`);
    }
    return r.stdout;
  };
  const json = async <T>(args: string[]) => JSON.parse(await gh(args)) as T;
  const missing = (e: unknown) => e instanceof GhError && NOT_FOUND.test(e.message);

  const prView = async (n: number): Promise<PullRequest> => {
    const v = await json<
      Omit<PullRequest, "checks" | "mergeCommit"> & {
        mergeCommit: { oid: string } | null;
        statusCheckRollup: RollupEntry[] | null;
      }
    >(["pr", "view", String(n), "--repo", slug, "--json", VIEW_FIELDS]);
    return {
      number: v.number,
      state: v.state,
      headRefName: v.headRefName,
      headRefOid: v.headRefOid,
      mergeCommit: v.mergeCommit?.oid ?? null,
      mergeStateStatus: v.mergeStateStatus,
      checks: (v.statusCheckRollup ?? []).map(toCheck),
      url: v.url,
    };
  };

  return {
    login: async () => (await gh(["api", "user", "--jq", ".login"])).trim(),

    tagRulesetOk: async () => {
      const list = await json<{ id: number; target: string }[]>(["api", `repos/${slug}/rulesets`]);
      for (const r of list.filter((x) => x.target === "tag")) {
        const d = await json<{
          enforcement: string;
          conditions?: { ref_name?: { include?: string[] } };
          rules?: { type: string }[];
        }>(["api", `repos/${slug}/rulesets/${r.id}`]);
        const types = (d.rules ?? []).map((x) => x.type);
        if (
          d.enforcement === "active" &&
          (d.conditions?.ref_name?.include ?? []).includes("refs/tags/v*") &&
          types.includes("deletion") &&
          types.includes("update")
        ) {
          return true;
        }
      }
      return false;
    },

    findPr: async (head) => {
      const found = await json<{ number: number }[]>([
        "pr",
        "list",
        "--repo",
        slug,
        "--head",
        head,
        "--state",
        "all",
        "--json",
        LIST_FIELDS,
        "--limit",
        "1",
      ]);
      return found[0] ? prView(found[0].number) : null;
    },

    openReleasePrs: async () => {
      const list = await json<Omit<PullRequest, "mergeCommit" | "mergeStateStatus" | "checks">[]>([
        "pr",
        "list",
        "--repo",
        slug,
        "--state",
        "open",
        "--json",
        LIST_FIELDS,
        "--limit",
        "100",
      ]);
      return list
        .filter((p) => p.headRefName.startsWith("release/v"))
        .map((p) => ({ ...p, mergeCommit: null, mergeStateStatus: "", checks: [] }));
    },

    createPr: async (head, base, title, bodyFile) => {
      const out = await gh([
        "pr",
        "create",
        "--repo",
        slug,
        "--base",
        base,
        "--head",
        head,
        "--title",
        title,
        "--body-file",
        bodyFile,
      ]);
      const m = /\/pull\/(\d+)/.exec(out);
      if (!m) throw new GhError(`gh pr create printed no PR URL: ${out.trim()}`);
      return Number(m[1]);
    },

    prView,

    mergePr: async (n, headCommit) => {
      await gh([
        "pr",
        "merge",
        String(n),
        "--repo",
        slug,
        "--merge",
        "--match-head-commit",
        headCommit,
      ]);
    },

    closePr: async (n, comment) => {
      await gh(["pr", "close", String(n), "--repo", slug, "--comment", comment, "--delete-branch"]);
    },

    release: async (tag) => {
      let r: {
        tag_name: string;
        draft: boolean;
        prerelease: boolean;
        body: string | null;
        html_url: string;
      };
      try {
        r = await json(["api", `repos/${slug}/releases/tags/${tag}`]);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
      let latest = "";
      try {
        latest = (await gh(["api", `repos/${slug}/releases/latest`, "--jq", ".tag_name"])).trim();
      } catch (e) {
        if (!missing(e)) throw e;
      }
      return {
        tagName: r.tag_name,
        draft: r.draft,
        prerelease: r.prerelease,
        latest: latest === tag,
        body: r.body ?? "",
        url: r.html_url,
      };
    },

    createRelease: async (tag, title, notesFile) => {
      await gh([
        "release",
        "create",
        tag,
        "--repo",
        slug,
        "--title",
        title,
        "--notes-file",
        notesFile,
        "--verify-tag",
        "--latest",
      ]);
    },

    commitChecks: async (sha) => {
      const out = await gh([
        "api",
        `repos/${slug}/commits/${sha}/check-runs`,
        "--paginate",
        "--jq",
        ".check_runs[]|{name,status,conclusion}",
      ]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => toCheck(JSON.parse(line) as RollupEntry));
    },
  };
}
