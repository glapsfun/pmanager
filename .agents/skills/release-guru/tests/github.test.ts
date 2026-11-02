import { expect, test } from "bun:test";
import { ghGitHub } from "../scripts/github";
import { scripted } from "./scripted";

const R = "acme/demo";

test("login reads the active account", async () => {
  const run = scripted([[["gh", "api", "user", "--jq", ".login"], { stdout: "vladtara\n" }]]);
  expect(await ghGitHub(R, run).login()).toBe("vladtara");
});

test("a failing gh call throws with gh's stderr", async () => {
  const run = scripted([
    [["gh", "api", "user", "--jq", ".login"], { code: 1, stderr: "gh auth login required\n" }],
  ]);
  await expect(ghGitHub(R, run).login()).rejects.toThrow("gh auth login required");
});

test("tagRulesetOk needs an active v* tag ruleset with deletion and update", async () => {
  const detail = (include: string[], rules: string[], enforcement = "active") =>
    JSON.stringify({
      enforcement,
      conditions: { ref_name: { include, exclude: [] } },
      rules: rules.map((type) => ({ type })),
    });
  const list = JSON.stringify([
    { id: 1, target: "branch", enforcement: "active" },
    { id: 2, target: "tag", enforcement: "active" },
  ]);
  const ok = scripted([
    [["gh", "api", `repos/${R}/rulesets`], { stdout: list }],
    [
      ["gh", "api", `repos/${R}/rulesets/2`],
      { stdout: detail(["refs/tags/v*"], ["deletion", "update"]) },
    ],
  ]);
  expect(await ghGitHub(R, ok).tagRulesetOk()).toBe(true);
  const missingUpdate = scripted([
    [["gh", "api", `repos/${R}/rulesets`], { stdout: list }],
    [["gh", "api", `repos/${R}/rulesets/2`], { stdout: detail(["refs/tags/v*"], ["deletion"]) }],
  ]);
  expect(await ghGitHub(R, missingUpdate).tagRulesetOk()).toBe(false);
  const disabled = scripted([
    [["gh", "api", `repos/${R}/rulesets`], { stdout: list }],
    [
      ["gh", "api", `repos/${R}/rulesets/2`],
      { stdout: detail(["refs/tags/v*"], ["deletion", "update"], "disabled") },
    ],
  ]);
  expect(await ghGitHub(R, disabled).tagRulesetOk()).toBe(false);
});

const VIEW_FIELDS =
  "number,state,headRefName,headRefOid,mergeCommit,mergeStateStatus,statusCheckRollup,url";
const viewJson = JSON.stringify({
  number: 12,
  state: "OPEN",
  headRefName: "release/v0.10.1",
  headRefOid: "abc",
  mergeCommit: null,
  mergeStateStatus: "BLOCKED",
  url: "https://github.com/acme/demo/pull/12",
  statusCheckRollup: [
    { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: "" },
    { __typename: "StatusContext", context: "ext", state: "PENDING" },
    { __typename: "StatusContext", context: "ext2", state: "FAILURE" },
  ],
});

test("prView maps check runs and status contexts", async () => {
  const run = scripted([
    [["gh", "pr", "view", "12", "--repo", R, "--json", VIEW_FIELDS], { stdout: viewJson }],
  ]);
  const pr = await ghGitHub(R, run).prView(12);
  expect(pr).toEqual({
    number: 12,
    state: "OPEN",
    headRefName: "release/v0.10.1",
    headRefOid: "abc",
    mergeCommit: null,
    mergeStateStatus: "BLOCKED",
    url: "https://github.com/acme/demo/pull/12",
    checks: [
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "e2e", status: "IN_PROGRESS", conclusion: null },
      { name: "ext", status: "IN_PROGRESS", conclusion: null },
      { name: "ext2", status: "COMPLETED", conclusion: "FAILURE" },
    ],
  });
});

test("findPr lists the head's newest PR, then views it; none is null", async () => {
  const list = ["gh", "pr", "list", "--repo", R, "--head", "release/v0.10.1", "--state", "all"];
  const json = ["--json", "number,state,headRefName,headRefOid,url", "--limit", "1"];
  const run = scripted([
    [[...list, ...json], { stdout: '[{"number":12}]' }],
    [["gh", "pr", "view", "12", "--repo", R, "--json", VIEW_FIELDS], { stdout: viewJson }],
    [[...list, ...json], { stdout: "[]" }],
  ]);
  const gh = ghGitHub(R, run);
  expect((await gh.findPr("release/v0.10.1"))?.number).toBe(12);
  expect(await gh.findPr("release/v0.10.1")).toBeNull();
});

test("openReleasePrs keeps open PRs from release branches", async () => {
  const run = scripted([
    [
      [
        "gh",
        "pr",
        "list",
        "--repo",
        R,
        "--state",
        "open",
        "--json",
        "number,state,headRefName,headRefOid,url",
        "--limit",
        "100",
      ],
      {
        stdout: JSON.stringify([
          { number: 3, state: "OPEN", headRefName: "feat/x", headRefOid: "a", url: "u3" },
          { number: 4, state: "OPEN", headRefName: "release/v0.11.0", headRefOid: "b", url: "u4" },
        ]),
      },
    ],
  ]);
  const prs = await ghGitHub(R, run).openReleasePrs();
  expect(prs.map((p) => p.number)).toEqual([4]);
});

test("createPr returns the number from the printed URL", async () => {
  const run = scripted([
    [
      [
        "gh",
        "pr",
        "create",
        "--repo",
        R,
        "--base",
        "main",
        "--head",
        "release/v0.10.1",
        "--title",
        "chore(release): v0.10.1",
        "--body-file",
        "/tmp/b.md",
      ],
      { stdout: "https://github.com/acme/demo/pull/31\n" },
    ],
  ]);
  const gh = ghGitHub(R, run);
  expect(await gh.createPr("release/v0.10.1", "main", "chore(release): v0.10.1", "/tmp/b.md")).toBe(
    31,
  );
});

test("mergePr merges with a merge commit against the expected head, never as admin", async () => {
  const cmd = ["gh", "pr", "merge", "12", "--repo", R, "--merge", "--match-head-commit", "abc"];
  const run = scripted([[cmd, {}]]);
  await ghGitHub(R, run).mergePr(12, "abc");
  expect(run.left()).toBe(0);
  expect(cmd).not.toContain("--admin");
});

test("closePr closes with a comment and leaves branches to git", async () => {
  const run = scripted([[["gh", "pr", "close", "12", "--repo", R, "--comment", "bye"], {}]]);
  await ghGitHub(R, run).closePr(12, "bye");
  expect(run.left()).toBe(0);
});

test("release reads a tag's release and whether it is latest; a missing one is null", async () => {
  const body = {
    tag_name: "v0.10.1",
    draft: false,
    prerelease: false,
    body: "notes",
    html_url: "https://github.com/acme/demo/releases/tag/v0.10.1",
  };
  const run = scripted([
    [["gh", "api", `repos/${R}/releases/tags/v0.10.1`], { stdout: JSON.stringify(body) }],
    [["gh", "api", `repos/${R}/releases/latest`, "--jq", ".tag_name"], { stdout: "v0.10.1\n" }],
    [
      ["gh", "api", `repos/${R}/releases/tags/v0.10.2`],
      { code: 1, stderr: "gh: Not Found (HTTP 404)\n" },
    ],
  ]);
  const gh = ghGitHub(R, run);
  expect(await gh.release("v0.10.1")).toEqual({
    tagName: "v0.10.1",
    draft: false,
    prerelease: false,
    latest: true,
    body: "notes",
    url: "https://github.com/acme/demo/releases/tag/v0.10.1",
  });
  expect(await gh.release("v0.10.2")).toBeNull();
});

test("createRelease publishes from the notes file on an existing tag as latest", async () => {
  const run = scripted([
    [
      [
        "gh",
        "release",
        "create",
        "v0.10.1",
        "--repo",
        R,
        "--title",
        "v0.10.1",
        "--notes-file",
        "/tmp/n.md",
        "--verify-tag",
        "--latest",
      ],
      {},
    ],
  ]);
  await ghGitHub(R, run).createRelease("v0.10.1", "v0.10.1", "/tmp/n.md");
  expect(run.left()).toBe(0);
});

test("commitChecks reads check runs as JSON lines, upper-cased", async () => {
  const run = scripted([
    [
      [
        "gh",
        "api",
        `repos/${R}/commits/abc/check-runs`,
        "--paginate",
        "--jq",
        ".check_runs[]|{name,status,conclusion}",
      ],
      {
        stdout:
          '{"name":"gate","status":"completed","conclusion":"success"}\n{"name":"x","status":"queued","conclusion":null}\n',
      },
    ],
  ]);
  expect(await ghGitHub(R, run).commitChecks("abc")).toEqual([
    { name: "gate", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "x", status: "QUEUED", conclusion: null },
  ]);
});
