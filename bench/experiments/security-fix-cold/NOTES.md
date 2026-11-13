# security-fix-cold: hand audit and decision

**The run.**
- Ten runs of `security-fix`, `with-skill` only, all `completed`, $12.02.
- The harness was claude-code 2.1.322 with claude-sonnet-5.
- `with-skill` is the skill as on main: the branch leaves `plugins/` unchanged; skill `sha256:5d44c8da...`, manifest at `0727d6a`.
- Profiles were on, refreshed by `prepareCondition`.
- Grader version 1 was used at run time. `RUBRIC.md` was committed before the run.

**The hand audit.** Two auditors read every plan, five each, against `RUBRIC.md`, without the grader's verdicts. Grader version 2 (below) re-grades the ten saved plans to the hand verdicts exactly.

**Offline.** The web tools were off: attempt 1's `system/init` listed 23 tools, neither `WebFetch` nor `WebSearch`. No agent ran a network command (install, `go mod tidy`, docker, scanner, `curl`, `gh`).

## Decision

Hand verdicts, failing attempts of 10, with how many failures were mechanical (the fact was in a file pm could extract without a model):

| Check | Failing | Mechanical |
| :--- | ---: | ---: |
| hit-repos-covered | 10 | 10 |
| fix-reaches-deploy | 9 | 9 |
| right-bump | 0 | |
| no-unproven-safe | 0 | |
| repos-registered | 0 | |
| no-manager-commands | 0 | |

The decision rule fixed before the run: "If mechanical failures reach 2 or more of 10 on any check, the next design builds the smallest offline `pm` change that serves them." Two checks reach it, so #17 goes on to a design. The two gaps:

1. **Which repos are hit.** Every plan missed webshop, which carries `golang.org/x/net` v0.23.0 (`webshop/go.mod:7`) and is not in the ticket.
2. **How a repo's fix ships.** Nine plans fixed storefront's two findings with no tag release and no argocd `newTag` step. So the npm and base-image fixes would never reach the cluster.

Everything else came out right in 10 of 10. orders went bump, `make release`, `image.tag`; a correct bump on every finding; the worker closed with its lockfile cited.

## What failed, and why

- **Webshop: research went only where the ticket pointed.**
  - Every run passed `--repo` for the named repos only (storefront, orders, worker).
  - No run opened `webshop/go.mod` or researched x/net there. p1's one webshop research used other keywords.
  - The facts were one `pm research golang.org/x/net --repo webshop` away. It printed `go.mod:7` for orders in every run.
  - p1, p7, p9 and p10 wrote a non-goal excluding webshop because the scan did not flag it. p8 wrote that it checked no other repo.
  - Nothing in pm says which registered repos carry a package.
- **Storefront's rollout: pm extracts orders' release link and not storefront's.**
  - For orders, `pm research --repo orders` prints the release link and its `plan:` line ("add a task that runs `make release` ... then a task ... that sets `image.tag`"). All ten followed it.
  - For storefront the profile holds only checks. Its release is a `v*` tag workflow (`.github/workflows/release.yml`, `README.md:16-18`). The file that deploys it is in another repo (argocd `workloads/storefront/kustomization.yaml`, `newTag`). pm links neither.
  - p3, p4, p5 and p9 wrote the gap down ("no registered release command ... unlike orders"). p2 assumed Argo CD picks up a new image, which a pinned `newTag` does not do. p5 wrote "roll it out through the normal deploy path".
  - The one pass, p6, found the path by accident. A research call on `--repo argocd` with the keyword "storefront" printed the kustomization's "bump newTag to roll out a release" comment.

## What went right

- **orders, 10 of 10.** Bump, `make release`, `image.tag`, in order. This is #60's release link and `plan:` line at work in a new scenario.
- **right-bump, 10 of 10.**
  - npm: every plan bumped express to a release that pins `path-to-regexp` 0.1.12 or later, or named the rule and kept an `overrides` entry as the fallback. None bumped the package alone or hand-edited the lockfile.
  - Go: every plan moved orders' `golang.org/x/net` to 0.36.0 itself; none used websocket v1.5.3.
  - Image: a newer base tag, a newer digest checked by an acceptance test, or an explicit `apk upgrade`.
- **The worker, 10 of 10.** Every plan cited `uv.lock` (`requests` 2.34.2) against the scan's range and treated it as an evidence conflict, not a plain "not affected".
  - Six raised the manifest floor (p3, p4, p5, p6, p9, p10).
  - Four added a task to find what the scanner actually saw (p1, p2, p4, p5).
  - p7 and p8 closed it conditionally after a check.

## Other findings

- **pm research drops npm lockfile lines.**
  - Without `--full`, research pruned storefront's `package-lock.json` hits as "data". p6 call 10: "pruned: 3 lines (import 0, data 3, budget 0)"; p9 call 4: "files (0 of 1)".
  - It kept the `go.mod`, `go.sum` and `uv.lock` lines. Every npm fact came from the agents' own grep.
  - A design that puts lockfile facts in research has to keep these lines.
- **The Go builder.**
  - x/net v0.36.0 needs go 1.23.0, and orders builds `FROM golang:1.22` with `GOTOOLCHAIN=local`.
  - p7 and p9 explicitly keep go 1.22, so their orders release would fail at build time. p10 names the risk. The other seven are silent.
  - None proposes websocket v1.5.3, which drops x/net, or a builder bump. Recorded as judgment, per the rubric.
- **pm research's own `gh` lookup reached GitHub.**
  - Every `pm research --repo` call ran `gh` internally, 3 to 5 lookups per run, and got "Could not resolve to a Repository".
  - Nothing came back and no plan changed. The soft block does not cover pm's own probe, as the design says.
- **The manager lint detour (#61), 4 of 10.**
  - p1, p2, p7 and p8 ran `bun run lint` and `bun test` in the manager, following the memo's section 4. That cost $0.16 to $0.35 input-side each.
  - p8 ran `git checkout main -- .` there, overwrote `docs/pm/INDEX.md` and the memo in its working tree, and restored both itself.
- **Profiles list `npm ci` and `uv sync` as checks.** Both need the network. No plan ran them during planning, but a handoff that copies them into criteria will fail offline.
- **Other advisories.** No plan noticed GHSA-37ch-88jc-xwx2 (`path-to-regexp` < 0.1.13); the rubric never required it.

## Per attempt

Hand verdicts. M is mechanical.

| Attempt | hit-repos | rollout | right-bump | safe claims | repos | manager | Cost | Time |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | ---: | ---: |
| p1 | fail M | fail M | pass | pass | pass | pass | $1.49 | 572 s |
| p2 | fail M | fail M | pass | pass | pass | pass | $1.26 | 509 s |
| p3 | fail M | fail M | pass | pass | pass | pass | $0.84 | 382 s |
| p4 | fail M | fail M | pass | pass | pass | pass | $0.98 | 418 s |
| p5 | fail M | fail M | pass | pass | pass | pass | $1.04 | 419 s |
| p6 | fail M | pass | pass | pass | pass | pass | $1.00 | 392 s |
| p7 | fail M | fail M | pass | pass | pass | pass | $1.73 | 615 s |
| p8 | fail M | fail M | pass | pass | pass | pass | $1.51 | 537 s |
| p9 | fail M | fail M | pass | pass | pass | pass | $1.13 | 445 s |
| p10 | fail M | fail M | pass | pass | pass | pass | $1.04 | 392 s |

Cost per run: median $1.09, mean $1.20. Time: median 7.2 minutes, 35 tool calls.

Input side, from each transcript at the prices that reproduce `costUsd`:

| Phase | Median | Mean |
| :--- | ---: | ---: |
| Drafting the first plan | $0.54 | $0.54 |
| Fix rounds after the first `pm record` | $0.07 | $0.07 |
| Manager lint detour | $0.00 | $0.11 |

## Rulings (the auditors', accepted)

- **A webshop miss is counted once,** under hit-repos-covered. fix-reaches-deploy is judged on the fixes a plan has.
- **"Not flagged by this scan" non-goals are scope statements,** not "no change" claims (p1, p7, p9, p10). A stricter reading would add 4 mechanical no-unproven-safe failures and change no decision.
- **Vague deploy steps fail fix-reaches-deploy** ("Argo CD picks up the new image", "the normal deploy path"). The deploy tag is a pinned `newTag` in argocd.
- **The storefront rollout misses are mechanical,** including where the plan named the gap (p7, p10) or assumed auto-deploy (p9): the rubric lists "which file deploys the image" as mechanical, and none opened `storefront/README.md` or the kustomization. A stricter reader could call p7 and p10 judgment; that leaves 7 of 10, still over the bar.
- **A newer digest of the same tag, checked by an acceptance test that the image has `libssl3` 3.3.3-r0 or later, passes** (p1, p10). It is not a digest pin of the same contents.
- **repos-registered:** every repo a task changes is listed; a repo named in passing is not changed.

## Grader version 2

Version 1 disagreed with the hand audit in 24 rows of 60; version 2 agrees in all 60. Each fix has a test written from a run's own wording, and each test failed first.

- **right-bump**
  - Reads a fix named by rule after the file it changes: "bump `express` in `storefront/package.json` to a version that resolves ...", "the `express` dependency to the latest 4.x release whose ...".
  - Reads `≥`, an entry inside `"overrides": { ... }`, a name's closing backtick, and a list item wrapped onto indented lines.
  - Reads a base-image move to "the next patch tag" or "the next Alpine minor" in the Dockerfile.
  - A `>=` with no verb before it ("`path-to-regexp` ≥0.1.12 in storefront") is a condition to check, not a bump.
- **no-unproven-safe**
  - A claim is one list item or prose paragraph, so "the guardrail metric is confirmed unaffected" is not paired with an advisory id from another item.
  - Quoted verdict options ("stale finding, no fix needed") and conditions ("either already patched, or fixed", "or confirming they are already fixed") are not claims.
- **repos-registered:** a repo named in passing ("Argo CD picks up the image", "the webshop dashboard") is not one the plan changes. argocd changes with a rollout, webshop with a fix of its own.
- **dependency-commands:** a heredoc body is text written to a file, not a command run. Version 1 read the plans' own `go get` and `npm install` lines in the `pm record` bundle as network attempts in 9 runs.

## For the next design

Smallest offline `pm` change, from the two mechanical gaps:

1. **Dependency facts across registered repos.**
   - When research names a package, list every registered repo whose lockfile or `go.mod` carries it, with the version and the direct parent.
   - Read `package-lock.json` too, which research now prunes.
   - This is what would have found webshop.
2. **Release and rollout links for tag-pushed images.**
   - A `v*` tag workflow that pushes an image is a release.
   - A kustomization `newTag` (or chart `image.tag`) in another registered repo that names that image is its rollout.
   - Research then prints the same `plan:` line it prints for orders.
   - This is #16 part 4's cross-repo link, which #16 left until a run showed a planner missing one; this run shows it in 9 of 10.
