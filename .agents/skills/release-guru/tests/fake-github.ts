import { readFile } from "node:fs/promises";
import { git } from "../../../../plugins/pmanager/skills/pmanager/tests/helpers";
import type { CheckState, GitHub, PullRequest, Release } from "../scripts/github";
import { type Fixture, mergePrIntoMain } from "./fixture";

/** GitHub in memory, with merges and tags living in the fixture's bare origin. */
export class FakeGitHub implements GitHub {
  prs: PullRequest[] = [];
  releases: Release[] = [];
  calls: string[] = [];
  bodies = new Map<number, string>();
  comments = new Map<number, string>();
  mergeExtra?: Record<string, string>;
  mergeStateOverride?: string;
  private checks = new Map<number, CheckState[]>();
  private commitCheckMap = new Map<string, CheckState[]>();
  private failing = new Set<string>();
  private user: string;
  private ruleset: boolean;

  constructor(
    private f: Fixture,
    opts: { login?: string; tagRuleset?: boolean } = {},
  ) {
    this.user = opts.login ?? "test";
    this.ruleset = opts.tagRuleset ?? true;
  }

  setChecks(pr: number, checks: CheckState[]): void {
    this.checks.set(pr, checks);
  }

  setCommitChecks(sha: string, checks: CheckState[]): void {
    this.commitCheckMap.set(sha, checks);
  }

  failNext(method: keyof GitHub): void {
    this.failing.add(method);
  }

  private enter(method: keyof GitHub): void {
    this.calls.push(method);
    if (this.failing.delete(method)) throw new Error(`fake ${method} failure`);
  }

  private async branchSha(name: string): Promise<string | null> {
    const r = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], this.f.bare);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  private find(n: number): PullRequest {
    const pr = this.prs.find((p) => p.number === n);
    if (!pr) throw new Error(`no PR #${n}`);
    return pr;
  }

  async login() {
    this.enter("login");
    return this.user;
  }

  async tagRulesetOk() {
    this.enter("tagRulesetOk");
    return this.ruleset;
  }

  async findPr(head: string) {
    this.enter("findPr");
    const pr = this.prs.filter((p) => p.headRefName === head).at(-1);
    return pr ? this.view(pr.number) : null;
  }

  async openReleasePrs() {
    this.enter("openReleasePrs");
    return this.prs.filter((p) => p.state === "OPEN" && p.headRefName.startsWith("release/v"));
  }

  async createPr(head: string, _base: string, _title: string, bodyFile: string) {
    this.enter("createPr");
    const sha = await this.branchSha(head);
    if (!sha) throw new Error(`head branch ${head} is not on origin`);
    if (this.prs.some((p) => p.headRefName === head && p.state === "OPEN")) {
      throw new Error(`a pull request for ${head} already exists`);
    }
    const number = this.prs.length + 1;
    this.prs.push({
      number,
      state: "OPEN",
      headRefName: head,
      headRefOid: sha,
      mergeCommit: null,
      mergeStateStatus: "",
      checks: [],
      url: `https://github.com/${this.f.cfg.slug}/pull/${number}`,
    });
    this.bodies.set(number, await readFile(bodyFile, "utf8"));
    if (!this.checks.has(number)) {
      this.checks.set(
        number,
        this.f.cfg.requiredChecks.map((name) => ({ name, status: "QUEUED", conclusion: null })),
      );
    }
    return number;
  }

  private async view(n: number): Promise<PullRequest> {
    const pr = this.find(n);
    const checks = this.checks.get(n) ?? [];
    if (pr.state === "OPEN") {
      pr.headRefOid = (await this.branchSha(pr.headRefName)) ?? pr.headRefOid;
      const upToDate =
        (await git(["merge-base", "--is-ancestor", "main", pr.headRefOid], this.f.bare)).code === 0;
      const green = checks.every(
        (c) => c.status === "COMPLETED" && ["SUCCESS", "SKIPPED"].includes(c.conclusion ?? ""),
      );
      pr.mergeStateStatus = !upToDate ? "BEHIND" : green ? "CLEAN" : "BLOCKED";
      if (this.mergeStateOverride) pr.mergeStateStatus = this.mergeStateOverride;
    }
    return { ...pr, checks: checks.map((c) => ({ ...c })) };
  }

  async prView(n: number) {
    this.enter("prView");
    return this.view(n);
  }

  async mergePr(n: number, headCommit: string) {
    this.enter("mergePr");
    const pr = await this.view(n);
    if (pr.state !== "OPEN") throw new Error(`PR #${n} is ${pr.state}`);
    if (pr.headRefOid !== headCommit)
      throw new Error(`head is ${pr.headRefOid}, not ${headCommit}`);
    if (pr.mergeStateStatus !== "CLEAN") throw new Error(`not mergeable: ${pr.mergeStateStatus}`);
    const merge = await mergePrIntoMain(this.f, pr.headRefName, n, this.mergeExtra);
    const stored = this.find(n);
    stored.state = "MERGED";
    stored.mergeCommit = merge;
  }

  async closePr(n: number, comment: string) {
    this.enter("closePr");
    const pr = this.find(n);
    pr.state = "CLOSED";
    this.comments.set(n, comment);
  }

  async release(tag: string) {
    this.enter("release");
    const r = this.releases.find((x) => x.tagName === tag);
    return r ? { ...r } : null;
  }

  async createRelease(tag: string, _title: string, notesFile: string) {
    this.enter("createRelease");
    if ((await git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], this.f.bare)).code) {
      throw new Error(`tag ${tag} is not on origin`);
    }
    if (this.releases.some((r) => r.tagName === tag)) {
      throw new Error(`a release for ${tag} already exists`);
    }
    for (const r of this.releases) r.latest = false;
    this.releases.push({
      tagName: tag,
      draft: false,
      prerelease: false,
      latest: true,
      body: await readFile(notesFile, "utf8"),
      url: `https://github.com/${this.f.cfg.slug}/releases/tag/${tag}`,
    });
  }

  async commitChecks(sha: string) {
    this.enter("commitChecks");
    return this.commitCheckMap.get(sha) ?? [];
  }
}
