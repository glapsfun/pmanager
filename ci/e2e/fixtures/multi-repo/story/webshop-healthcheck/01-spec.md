<!-- pm:file webshop-healthcheck/epic.md -->
---
id: webshop-healthcheck
title: Health check endpoint for the webshop
type: feature
status: approved
business-goal: fewer customer-facing errors while a webshop release rolls out
owner: unassigned
created: 2026-10-20
updated: 2026-10-20
contract: 1
primary-metric: "HTTP 5xx responses served during a webshop rollout"
repos:
  - https://github.com/pm-example/webshop.git
  - https://github.com/pm-example/argocd.git
session:
  harness: claude-code
  claimed: 2026-10-20
  branch: pm/webshop-healthcheck
  id: {{session}}
---

# Health check endpoint for the webshop

## Problem statement (required)

During a rollout Kubernetes sends traffic to new webshop pods as soon as the
container starts, before the service is ready, and never restarts a pod that
hangs. Customers see errors for the first seconds of every release and for
as long as a stuck pod lives.

## Evidence (required)

| Source | Finding | Kind |
| :--- | :--- | :--- |
| [webshop/main.go:13-15] | the service registers only `/`; there is no health endpoint | behavioral |
| [argocd/workloads/webshop/deployment.yaml:14-24] | the webshop container has no readiness or liveness probe | behavioral |
| [webshop/README.md:17-19] | releases ship by bumping `newTag` in the argocd repo | stated |
| [user] | "we get a burst of 502s on every webshop release" | stated |

**Confidence:** medium. A count of 5xx per rollout from the ingress logs would raise it.

## Hypothesis (required)

We believe a `/healthz` endpoint with readiness and liveness probes on it will
stop traffic reaching webshop pods before they are ready, measured by 5xx
responses during a rollout dropping from about 40 to 0 within the next two
releases.

## Business goal alignment

Every release currently costs customer-facing errors, which makes the team
release less often.

## Stakeholders / affected users

Shop customers during releases; the webshop and argocd repo owners review the
changes.

## Success metrics (required)

| Metric | Role | Current | Target | Window | Measured via |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 5xx responses during a webshop rollout | primary | ~40 (assumption, last two releases) | 0 | next 2 releases | ingress-nginx access logs |
| webshop rollout duration | guardrail | ~60s | <=90s | same | Argo CD sync history |

## Scope

- `GET /healthz` in the webshop service, with a unit test
- readiness and liveness probes on `/healthz` in the argocd webshop Deployment
- release 1.5.0 with the endpoint and roll it out through argocd

## Non-goals (required)

- Dependency checks inside `/healthz` (database, payment provider): a failing dependency must not restart every pod.
- Probes for ingress-nginx: it ships its own.

## Open questions

none

## Related prior work

none, cold start: no prior epics in `docs/pm/INDEX.md`.

## Outcome

<!-- pm:file webshop-healthcheck/plan.md -->
---
epic: webshop-healthcheck
status: approved
updated: 2026-10-20
contract: 1
---

# Plan: Health check endpoint for the webshop

## Approach

Add a dependency-free `/healthz` handler to the webshop service first, then
point the Deployment's readiness and liveness probes at it in the same argocd
change that rolls out the release carrying it. Probes must not land before
the image that serves `/healthz`, or every new pod fails its probe.

## Milestones

### M1: The webshop serves /healthz
Exit criteria:
- [ ] `GET /healthz` returns 200 and `make test` passes in the webshop repo

### M2: Probes are live on the new release
Exit criteria:
- [ ] The webshop Deployment in argocd probes `/healthz` and runs image 1.5.0

## Task breakdown & traceability

<!-- pm:tasks:start -->
<!-- pm:tasks:end -->

This table is rendered from the task files by `pm render`; never edit it by
hand.

## Prioritization

- Must: T01, T02. Without both, traffic still reaches pods before they are ready.
- Won't (this epic): dependency checks in `/healthz`; ingress-nginx probes (both epic non-goals).

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger / early signal |
| :--- | :--- | :--- | :--- | :--- |
| Probes ship before the image that serves `/healthz` | med | high | T02 depends on T01 and bumps the tag in the same commit | new pods stuck NotReady after sync |

## Dependencies

| Dependency | Kind | Owner | Status |
| :--- | :--- | :--- | :--- |
| webshop release 1.5.0 published | internal | webshop | needed by T02 |

## Definition of done (applies to every task)

- [ ] Acceptance criteria demonstrated
- [ ] Tests written/updated and passing
- [ ] Code reviewed

## Validation plan

- **Verification:** M1 by `make test` in the webshop repo; M2 by the argocd diff and the Application's health after sync.
- **Validation:** count 5xx in the ingress logs during the next two releases.

## Changelog

| Date | Change | Why |
| :--- | :--- | :--- |
| 2026-10-20 | Plan created | Epic approved |
<!-- pm:file webshop-healthcheck/tasks/T01-healthz-endpoint.md -->
---
id: T01
epic: webshop-healthcheck
milestone: M1
title: Serve GET /healthz from the webshop
status: todo
priority: must
depends-on: []
estimate: S
owner: unassigned
updated: 2026-10-20
contract: 1
---

# T01 Serve GET /healthz from the webshop

## Context

The webshop has no endpoint a probe can call (`../epic.md`, evidence row 1).

## What to do

Add a `/healthz` handler in `main.go` that returns 200 with a short body and
checks nothing else. Cover it in `main_test.go`. Follow the webshop README:
`make test` and `make lint` before the pull request.

## Acceptance criteria

- [ ] `main.go` registers `/healthz` and it returns 200
- [ ] `main_test.go` covers `/healthz` and `make test` passes

## Out of scope

- Probes in the argocd repo (T02).
- Any dependency check inside the handler.

## Notes
<!-- pm:file webshop-healthcheck/tasks/T02-probes-and-release.md -->
---
id: T02
epic: webshop-healthcheck
milestone: M2
title: Probe /healthz and roll out webshop 1.5.0
status: todo
priority: must
depends-on: [T01]
estimate: S
owner: unassigned
updated: 2026-10-20
contract: 1
---

# T02 Probe /healthz and roll out webshop 1.5.0

## Context

With T01 released as 1.5.0, the Deployment can probe `/healthz`
(`../epic.md`, evidence row 2).

## What to do

In the argocd repo, add readiness and liveness probes on `/healthz` port 8080
to the webshop container, and bump `newTag` to `1.5.0` in the same commit.
CI runs yamllint and kubeconform on the change.

## Acceptance criteria

- [ ] `workloads/webshop/deployment.yaml` has readiness and liveness probes on `/healthz`
- [ ] `workloads/webshop/kustomization.yaml` pins `newTag: 1.5.0`

## Out of scope

- Changing replicas or resources.

## Notes
