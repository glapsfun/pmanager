# security-fix-cold: hand-audit rubric

Written before any run. Design: `.docs/specs/2026-11-11-security-fix-bench-design.md` (#17). Facts: `bench/scenarios/security-fix-facts.ts`.

## Question

Given a security ticket with four findings and today's main, with profiles on and no network, how often does a fix plan:

- miss a hit repo;
- never deploy the fix;
- bump the wrong thing;
- call something safe without proof?

## The ticket and the fixture

| Finding | Advisory | Flagged in | Where it really is | Correct fix |
| :--- | :--- | :--- | :--- | :--- |
| npm | GHSA-rhx6-c78j-4q9w, `path-to-regexp` < 0.1.12 | storefront | `package-lock.json`: express 4.21.1 pins `path-to-regexp` 0.1.10 exactly | express 4.21.2 or later, or an override; then tag, release, `newTag` in argocd |
| Go | GHSA-qxp5-gwg8-xv66, `golang.org/x/net` < 0.36.0 | orders | `go.mod` `// indirect`: orders 0.17.0 (via `gorilla/websocket` v1.5.1), webshop 0.23.0 (via v1.5.2) | `go get golang.org/x/net@v0.36.0` (or later), or websocket v1.5.3, which drops x/net; then the release and the rollout, in both repos |
| Python | GHSA-9hjg-9r4m-mvj7, `requests` < 2.32.4 | worker | `pyproject.toml` admits `>=2.31`; `uv.lock` pins 2.34.2 | none: not affected, with the lockfile cited |
| Image | CVE-2024-12797, `libssl3` 3.3.2-r1 in `node:20.18.1-alpine3.20` | storefront image | `storefront/Dockerfile` `FROM` | a newer base tag (contents to be confirmed) or an explicit package upgrade; then rebuild, release, `newTag` |

The ticket does not name webshop. Its rollout paths are:
- orders: `make release`, then `deploy/chart/values.yaml` `image.tag`;
- webshop: a `v*` tag, then argocd `workloads/webshop/kustomization.yaml` `newTag`;
- storefront: a `v*` tag, then argocd `workloads/storefront/kustomization.yaml` `newTag`.

## Per attempt

For each graded attempt, read `artifacts/<attempt>/docs-pm/` (epic, plan, tasks) and the transcript (`raw.jsonl`). Record one row per check:

| Check | Verdict | Source | Class |
| :--- | :--- | :--- | :--- |
| hit-repos-covered | pass / fail | | mechanical / judgment |
| fix-reaches-deploy | pass / fail | | |
| right-bump | pass / fail | | |
| no-unproven-safe | pass / fail | | |
| repos-registered | pass / fail | | |
| no-manager-commands | pass / fail | | |

The verdict comes from reading the plan, not from the grader alone. Where the two differ, the hand verdict stands, and `NOTES.md` records the grader bug and the re-grade (grader version 2).

**Source.** From the transcript: the agent opened the file that holds the fact, or `pm research` output showed it. The files are:
- the lockfile or `go.mod`;
- `pyproject.toml`;
- the `Dockerfile`;
- the release workflow or `Makefile`;
- the kustomization or `values.yaml`.

A pass with no traceable source is "passed, source unclear".

**Class**, for every failure:
- **Mechanical:** the fact was in a file pm could extract without a model, such as which repos carry the package at which version, which direct dependency pulls it in, or which file deploys the image.
- **Judgment:** the planner had the fact and still planned wrong.

## Rules (copied from the design)

**right-bump in detail.** These fixes pass:
- upgrading the direct parent;
- Go's `go get <module>@<fixed>`, even though it adds an `// indirect` line to `go.mod`;
- a stated override or resolution;
- refreshing the lockfile when the parent's declared range already allows the fixed version.

No file says which parent release brings in the fix, so a plan may name the rule ("the first parent release that resolves to the fixed version or later") and record the exact version as an open question. A named version that is still affected fails, and so does hand-editing a lockfile.

**The base image.** A pass changes the `Dockerfile` so the image gets the fixed package, then rebuilds, releases and rolls out. The change is either a newer base tag, with "contains the fixed package" marked to be confirmed, or an explicit package-upgrade line. A digest pin of the same contents fails.

**The worker.**
- Says "not affected" and cites the lockfile: pass.
- Also raises the manifest's lower bound, with the citation: pass.
- Bumps it anyway: not a failure; recorded.
- Leaves the flagged worker out without a word: fails `no-unproven-safe`, because an unaddressed finding is an unproven "no change".

## Cases the grader does not settle

- **npm package bumped directly.** A plan that runs `npm install path-to-regexp@0.1.12` without an override or an express bump fails `right-bump`: express pins its own copy exactly, so the nested copy stays. A plan that both bumps express and names the package's version passes on the express bump.
- **One task doing several steps.** A task that both fixes and releases, or both releases and rolls out, passes those steps of `fix-reaches-deploy`, in that order.
- **A conditional claim.** "If webshop is not affected, skip T08" counts as a claim only when the plan then drops the work. Read it by hand.
- **Claims about other repos.** A claim about infra or argocd is outside `no-unproven-safe`, because neither has dependency files. Note it if one is made.
- **Placement misses.** A grader verdict whose evidence names a fix with no task is read by hand: find the task in the plan, place it, and re-grade.
- **Versions by memory.** A plan naming a fixing version from memory (for example express 4.22.x, or a newer node tag) passes when the version is at or above the fixed one. Record whether it marked the version as to be confirmed.

## Record per attempt, not gated

- **`dependency-commands`:** the network attempts, the web tool calls and the explain commands (`npm ls`, `npm explain`, `go mod why` and the like), and whether each explain command worked offline.
- **Lockfiles opened:** which ones the transcript opened (`package-lock.json`, `go.mod`, `go.sum`, `uv.lock`, `Dockerfile`).
- **Runs that got online:** what was fetched, and whether it changed the plan. Such a run is graded normally and flagged.
- **Other advisories:** whether the plan noticed that express's newer releases fix a later `path-to-regexp` advisory too (GHSA-37ch-88jc-xwx2). This is never required.
- **Cost:** cost, the phase breakdown used in the #16 runs, and wall time.

## Record per run

The manifest's fixture hash covers only the manager repo, so the targets' trees are pinned by `bench/tests/scenario-security-fix.test.ts` (`git -C <fixture>-pm-workspace/<repo> rev-parse HEAD^{tree}`):

| Repo | Tree | Commit (a UTC build) |
| :--- | :--- | :--- |
| orders | `83576bd3f11c391c95b3c93f15b282bd4d2a9ec7` | `ee6e51c4bab3f14fb62deaf4bee2658c33e026e0` |
| webshop | `cc1efee07550324e410d84679d19b803144b0359` | `b8fa62b64ed48c5b1d54892a3f774c2581a00ccd` |
| argocd | `d9e5a06ca2eaae0f4477aaa4da820d789ff99734` | `2e7b54e803416d68f06c598167bdc89da593a7ab` |
| storefront | `b421cdaa132e8d7262177b9cfb44b4995a11b53e` | `b53c5bea95fd00b9a570a1c4c7d0b3d8e5887aeb` |
| worker | `8d6fbb1b2259420e5cc75e57ec5767d4b7ad9012` | `5e4dd2d081a9b79c6b572cbce6cb204a020432a3` |

## Exclusions

- Harness or API failures (a crash or an API error) are excluded.
- So is an attempt whose plan is not in the fixture because the agent skipped `--no-worktree`, since its plan cannot be read.
- A timeout counts as failed.
- Fewer than 8 graded attempts makes the experiment inconclusive; topping up is the user's call.

## Decision rule (copied from the design, fixed before the run)

If mechanical failures reach 2 or more of 10 on any check, the next design builds the smallest offline `pm` change that serves them (likely lockfile facts in profiles and research). Otherwise #17 closes with the measurement. Every other check, the cost and the duration are reported with no threshold.
