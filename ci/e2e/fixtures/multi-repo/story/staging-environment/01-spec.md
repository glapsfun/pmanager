<!-- pm:file staging-environment/epic.md -->
---
id: staging-environment
title: Stand up a staging environment for the webshop
type: feature
status: approved
business-goal: catch webshop bugs before they reach prod customers
owner: unassigned
created: 2026-11-04
updated: 2026-11-04
contract: 1
primary-metric: "% of webshop prod syncs preceded by a staging sync of the same revision"
repos:
  - https://github.com/pm-example/infra.git
  - https://github.com/pm-example/argocd.git
session:
  harness: claude-code
  claimed: 2026-11-04
  branch: pm/staging-environment
  id: {{session}}
---

# Stand up a staging environment for the webshop

## Problem statement (required)

The webshop deploys straight into the prod-eu cluster via Argo CD, with no
environment to catch a bad release before it reaches customers. There is
only one Terraform environment and the Argo CD app-of-apps only ever
targets the in-cluster destination, so any webshop change is first observed
in production.

## Evidence (required)

| Source | Finding | Kind |
| :--- | :--- | :--- |
| [infra/envs/prod/main.tf:18-27] | prod-eu is the only Terraform environment, built from `modules/network` + `modules/cluster` | behavioral |
| [infra/modules/cluster/main.tf:17-26] | cluster module is already parameterized (`cluster_name`, `network_id`, `server_count`, default 3) — reusable for a second environment with no module changes | behavioral |
| [infra/AGENTS.md:14] | `cluster_name`/`ingress_lb_name` outputs are a contract with the argocd repo; renaming an existing one needs a coordinated change, but a new env's own names don't touch it | behavioral |
| [argocd/apps/root.yaml:12-13] | app-of-apps destination is hardcoded to `https://kubernetes.default.svc` — Argo CD today only ever deploys in-cluster | behavioral |
| [argocd/apps/ingress-nginx.yaml:17-21] | ingress-nginx Application is hardcoded to the prod LB name (`prod-eu-ingress`) and the in-cluster destination — a staging cluster needs its own copy, not just webshop | behavioral |
| [argocd/workloads/webshop/ingress.yaml:8] | webshop Ingress hardcodes `host: shop.example.com` with no overlay/per-env variant | behavioral |
| [user, 2026-11-04] | staging should reuse the existing Argo CD instance as a remote destination, run 1 node + the same LB setup, track `main` with auto-sync, answer on `staging.shop.example.com` | stated |
| [user, 2026-11-04] | goal is to catch webshop bugs before prod; done means every webshop release runs on staging first and staging answers on that host | stated |
| [user, 2026-11-04] | DNS for `staging.shop.example.com` is handled outside these repos — external dependency | stated |

**Confidence:** medium — the infra and argocd mechanics are well evidenced from the repos; the operational practice ("every release runs on staging first") is a stated intent that isn't observable yet. Confidence would rise after a few real webshop releases confirm the sync ordering.

## Hypothesis (required)

We believe adding a staging cluster (via infra) and registering it as a
second Argo CD destination for webshop, auto-synced from `main`, will mean
every webshop release runs on staging before it is promoted to prod,
measured by the primary metric reaching 100% within the month following
rollout.

## Business goal alignment

Catching webshop regressions on staging before they reach prod customers;
reduces the chance of a bad release causing a prod incident.

## Stakeholders / affected users

Engineers deploying the webshop (direct users of the new environment);
whoever owns the infra and argocd repos (reviews the Terraform/Argo CD
changes); on-call/ops if a staging misconfiguration risks touching prod.

## Success metrics (required)

| Metric | Role | Current | Target | Window | Measured via |
| :--- | :--- | :--- | :--- | :--- | :--- |
| % of webshop prod syncs preceded by a staging sync of the same git revision | primary | 0% (no staging exists) | 100% | continuous from rollout, reviewed at +1 month | Argo CD sync history for the `webshop` and `webshop-staging` Applications |
| prod webshop sync/deploy success rate | guardrail | assumed healthy today (no incident evidence either way) | unaffected by staging changes | same window | Argo CD sync health for the prod `webshop` Application |

## Scope

- `infra`: new `envs/staging` Terraform root module, reusing `modules/network`
  and `modules/cluster`, 1 server node, the same `lb11` load balancer setup,
  a separate tfstate key, `cluster_name = staging-eu`
- `argocd`: register the staging cluster as a second remote Argo CD
  destination (cluster credentials secret) on the existing Argo CD instance
- `argocd`: staging `ingress-nginx` Application (own LB name annotation) and
  staging `webshop` Application, both destined to the staging cluster,
  tracking `main`, auto-sync
- `argocd`: restructure the webshop manifests so the staging copy answers on
  `staging.shop.example.com` while prod keeps `shop.example.com`

## Non-goals (required)

- No automated staging→prod promotion gate — promoting to prod stays a
  manual/separate step; this epic only guarantees staging exists and runs
  `main` first.
- No second Argo CD control plane — staging is registered as a remote
  destination on the existing instance, not a new installation.
- No HA for staging — single node, accepted cost/availability tradeoff since
  staging is not customer-facing.
- No DNS record management — creating `staging.shop.example.com` and
  pointing it at the staging load balancer happens outside these two repos;
  tracked here only as an external dependency.

## Open questions

- Who/what creates and maintains the DNS record for
  `staging.shop.example.com`? Not answerable from these repos; tracked as an
  external dependency in the plan, and it blocks full end-to-end
  verification (T07) until resolved.

## Related prior work

webshop-healthcheck (done 2026-10-30): added `/healthz` and the probes; staging reuses them.

## Outcome

<!-- pm:file staging-environment/plan.md -->
---
epic: staging-environment
status: approved
updated: 2026-11-04
contract: 1
---

# Plan — Stand up a staging environment for the webshop

## Approach

Reuse the existing, already-parameterized `modules/network`/`modules/cluster`
Terraform modules to stand up a second, smaller environment (`envs/staging`,
1 node) instead of building new modules. On the Argo CD side, register the
staging cluster as a second remote destination on the existing Argo CD
instance instead of running a second control plane — this is the standard
Argo CD multi-cluster pattern and avoids maintaining two Argo CD
installations. The main alternative considered — a wholly separate Argo CD
per cluster — was rejected because it doubles operational surface for no
benefit here; the trade-off is that a cluster-registration mistake has a
(mitigated) blast radius against the existing instance, addressed in the
risk register. Webshop manifests move from a single flat set to a
kustomize base + per-env overlay so prod and staging can answer on
different hosts without duplicating the whole manifest tree.

## Milestones

### M1 — Staging cluster provisioned
Exit criteria:
- [ ] `envs/staging` passes `terraform fmt -recursive`, `terraform validate`, and `tflint --recursive`
- [ ] CI has applied `envs/staging` and the staging Hetzner servers + load balancer exist

### M2 — Staging registered as an Argo CD destination
Exit criteria:
- [ ] The staging cluster appears in `argocd cluster list` (or equivalent) as a healthy destination on the existing Argo CD instance
- [ ] Registration does not change the prod destination's entry or health

### M3 — Workloads running on staging
Exit criteria:
- [ ] The staging `ingress-nginx` Application is Synced/Healthy and attached to the staging load balancer
- [ ] The staging `webshop` Application is Synced/Healthy and its Ingress is configured for `staging.shop.example.com`
- [ ] `kustomize build` + `kubeconform` pass for both the prod and staging webshop overlays

### M4 — Staging-first workflow validated
Exit criteria:
- [ ] A real webshop change to `main` is observed syncing to staging before (or without ever reaching) prod in the same form
- [ ] `staging.shop.example.com` resolves and serves the webshop once DNS (external dependency) is in place

## Task breakdown & traceability

<!-- pm:tasks:start -->
| Task | Title | Milestone | Priority | Depends on | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| T01 | Add a staging Terraform environment in infra | M1 | must | — | todo |
| T02 | Merge the staging environment and capture cluster access for Argo CD | M1 | must | T01 | todo |
| T03 | Register the staging cluster as a remote Argo CD destination | M2 | must | T02 | todo |
| T04 | Split webshop manifests into a kustomize base plus prod/staging overlays | M3 | must | — | todo |
| T05 | Add a staging ingress-nginx Argo CD Application | M3 | must | T03 | todo |
| T06 | Add a staging webshop Argo CD Application | M3 | must | T03, T04, T05 | todo |
| T07 | Validate the staging-first workflow end-to-end | M4 | must | T06 | todo |
<!-- pm:tasks:end -->

This table is rendered from the task files by `pm render`; never edit it by
hand. Every task maps to a milestone; every milestone serves the epic's
primary metric.

## Prioritization

- Must: T01, T02, T03, T04, T05, T06 — the hypothesis cannot be tested at
  all without a staging cluster, its registration, and both Applications
  running on it.
- Must: T07 — it is the only task that actually measures the primary
  metric; without it "staging exists" is never confirmed as "staging runs
  releases first."
- Won't (this epic): automated staging→prod promotion gating (mirrors the
  epic's non-goal); a second Argo CD control plane (mirrors the epic's
  non-goal); DNS record management (external dependency, see below).

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger / early signal |
| :--- | :--- | :--- | :--- | :--- |
| Registering the staging cluster misconfigures or disrupts the existing Argo CD instance's management of prod | low | high | scope the staging cluster secret narrowly; validate with the low-risk `ingress-nginx` app before adding `webshop`; review prod Application health immediately after registration | prod Applications show unexpected sync activity or health changes after M2 |
| Copy-pasting `envs/prod` into `envs/staging` reuses the prod tfstate key, corrupting prod state | low | high | use a distinct state key (`staging/terraform.tfstate`) from the start; CI plan review before apply catches a shared-key diff | `terraform plan` for staging shows changes to prod resources |
| DNS record for `staging.shop.example.com` is never created, blocking end-to-end verification | medium | medium | flag early as an external dependency (done); request it once the staging LB IP is known from M1 | T07 cannot resolve the staging host after M3 is otherwise complete |
| Single-node staging cluster has no failover | low | low | accepted tradeoff — staging is not customer-facing | staging cluster becomes unavailable, blocking pre-prod checks only |

Revisit at every plan update — stale risk registers are worse than none.

## Dependencies

| Dependency | Kind | Owner | Status |
| :--- | :--- | :--- | :--- |
| DNS record `staging.shop.example.com` → staging load balancer IP | external | unassigned | needed (blocks T07 full verification) |
| Staging cluster credentials for Argo CD registration | internal | infra | produced by T02 |

## Definition of done (applies to every task)

- [ ] Acceptance criteria demonstrated
- [ ] Tests written/updated and passing
- [ ] Code reviewed
- [ ] Docs updated where behavior changed

## Validation plan

- **Verification:** each milestone's exit criteria above, demonstrated via
  `terraform validate`/`tflint` output (M1), `argocd cluster list` and
  Application health (M2/M3), and a successful DNS resolution + HTTP check
  against `staging.shop.example.com` (M4).
- **Validation:** after rollout, review Argo CD sync history for the
  `webshop` and `webshop-staging` Applications for each release over the
  following month, confirming the staging sync of a revision precedes (or
  is concurrent with) the prod sync of the same revision; also confirm prod
  sync health shows no regression over the same window (guardrail).

## Changelog

| Date | Change | Why |
| :--- | :--- | :--- |
| 2026-11-04 | Plan created | Epic approved; initial decomposition into infra, Argo CD registration, workloads, and validation |
<!-- pm:file staging-environment/tasks/T01-staging-terraform-env.md -->
---
id: T01
epic: staging-environment
milestone: M1
title: Add a staging Terraform environment in infra
status: todo
priority: must
depends-on: []
estimate: M
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T01 — Add a staging Terraform environment in infra

## Context

The epic (`../epic.md`) needs a second cluster before anything else can
happen. `infra/modules/cluster` and `infra/modules/network` are already
parameterized by `cluster_name`/`network_id`/`server_count`
[infra/modules/cluster/main.tf:9-19], so a second environment is a new root
module, not a module change. `infra/envs/prod/main.tf:18-27` is the pattern
to mirror.

## What to do

- Create `infra/envs/staging/main.tf` mirroring `envs/prod`: a `module
  "network"` and `module "cluster"` block, with its own `backend "s3"` key
  (e.g. `staging/terraform.tfstate`, same bucket) so it never shares state
  with prod.
- Set `cluster_name = "staging-eu"`, `server_count = 1` (prod defaults to 3
  — staging is explicitly smaller per the epic's scope).
- Keep the same `cluster_name`/`ingress_lb_name` outputs as `envs/prod` so
  the argocd repo can consume them the same way.
- Follow `infra/AGENTS.md`: run `terraform fmt -recursive`, `terraform
  -chdir=envs/staging init -backend=false && terraform -chdir=envs/staging
  validate`, and `tflint --recursive` before committing; branch as
  `infra/staging-environment`.

## Acceptance criteria

- [ ] `infra/envs/staging/main.tf` exists, reusing `modules/network` and
      `modules/cluster` with no changes to either module
- [ ] `cluster_name = "staging-eu"`, `server_count = 1`, and the tfstate key
      is distinct from `prod/terraform.tfstate`
- [ ] `terraform fmt -recursive`, `terraform validate`, and `tflint
      --recursive` all pass
- [ ] PR opened against `infra` (CI posts the plan; no `terraform apply` run
      from a workstation, per `AGENTS.md`)

## Out of scope

- Running `terraform apply` (CI applies after merge) — covered by T02.
- Any change to `modules/network` or `modules/cluster`.
- DNS or Argo CD changes.

## Notes

Evidence: [infra/envs/prod/main.tf:1-35], [infra/modules/cluster/main.tf],
[infra/AGENTS.md:3-15].
<!-- pm:file staging-environment/tasks/T02-apply-staging-capture-access.md -->
---
id: T02
epic: staging-environment
milestone: M1
title: Merge the staging environment and capture cluster access for Argo CD
status: todo
priority: must
depends-on: [T01]
estimate: S
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T02 — Merge the staging environment and capture cluster access for Argo CD

## Context

`infra/AGENTS.md:11-12` is explicit: CI posts the plan on the PR and applies
after merge — nobody runs `terraform apply` from a workstation. Once T01's
PR merges and CI applies it, the staging-eu cluster and its load balancer
exist, but Argo CD (Phase M2) needs a way to authenticate to the new
cluster. This task closes that gap.

## What to do

- Merge T01's PR and confirm CI's post-merge apply of `envs/staging`
  succeeds.
- Retrieve access to the new staging-eu cluster (kubeconfig or a
  service-account token scoped to it) through whatever channel the team
  already uses for the prod cluster's access (k3s install output,
  secrets manager, etc.) — this task does not invent a new access
  mechanism, it uses the existing one for a second cluster.
- Store the credential wherever T03 expects to read it from (e.g. the same
  secrets store backing the existing Argo CD cluster secret for prod), and
  record where it lives in this task's Notes.

## Acceptance criteria

- [ ] CI shows a successful apply of `infra/envs/staging`
- [ ] The `staging-eu` Hetzner servers and `staging-eu-ingress` load
      balancer exist (confirmed via `hcloud` or the Hetzner console)
- [ ] A kubeconfig or service-account token for `staging-eu` is retrieved
      and stored in the same place prod's credential lives, ready for T03

## Out of scope

- Registering the cluster with Argo CD (T03).
- Any Kubernetes workload changes.

## Notes

Evidence: [infra/AGENTS.md:11-12] (CI applies after merge, not a
workstation).
<!-- pm:file staging-environment/tasks/T03-register-staging-destination.md -->
---
id: T03
epic: staging-environment
milestone: M2
title: Register the staging cluster as a remote Argo CD destination
status: todo
priority: must
depends-on: [T02]
estimate: M
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T03 — Register the staging cluster as a remote Argo CD destination

## Context

Today Argo CD only ever deploys in-cluster:
`argocd/apps/root.yaml:12-13` and `argocd/apps/ingress-nginx.yaml:20-21` both
hardcode `destination.server: https://kubernetes.default.svc`. Per the
epic's approved decision, staging reuses this existing Argo CD instance
instead of a second control plane — this task adds the staging cluster as
a second, named destination so later Applications (T05, T06) can target it.
This is the riskiest step for prod safety, per the plan's risk register.

## What to do

- Using the staging-eu credential from T02, register the cluster with the
  Argo CD instance running in prod-eu (the standard `argocd cluster add`
  flow, or the equivalent declarative cluster `Secret` in the `argocd`
  namespace — match whatever pattern this Argo CD install already expects;
  there is no existing example in this repo, so this is new ground).
- Give the destination a clear name (e.g. `staging-eu`) distinct from the
  default in-cluster one.
- After registering, check the prod Applications' health and sync status
  are unchanged (risk register mitigation).

## Acceptance criteria

- [ ] The staging cluster appears as a healthy, named destination (e.g.
      `staging-eu`) in Argo CD, separate from the in-cluster destination
- [ ] The existing `root`, `ingress-nginx`, and `webshop` Applications
      (all prod, in-cluster) show unchanged Synced/Healthy status after
      registration
- [ ] The registration mechanism (cluster Secret manifest or documented
      `argocd cluster add` command) is committed to the `argocd` repo so it
      is reproducible, not a one-off manual action

## Out of scope

- Any Application that deploys *to* the new destination (T05, T06).
- Changing the existing in-cluster destination's name or config.

## Notes

Evidence: [argocd/apps/root.yaml:12-13], [argocd/apps/ingress-nginx.yaml:20-21],
[argocd/README.md] (single cluster, single Argo CD today). This is the step
with no existing precedent in either repo — budget extra review time.
<!-- pm:file staging-environment/tasks/T04-kustomize-overlays.md -->
---
id: T04
epic: staging-environment
milestone: M3
title: Split webshop manifests into a kustomize base plus prod/staging overlays
status: todo
priority: must
depends-on: []
estimate: M
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T04 — Split webshop manifests into a kustomize base plus prod/staging overlays

## Context

`argocd/workloads/webshop/ingress.yaml:8` hardcodes `host:
shop.example.com` and `argocd/workloads/webshop/kustomization.yaml` has no
overlay structure — every consumer of this path gets the same host. Once a
staging `webshop` Application (T06) points at this tree, it would otherwise
deploy the prod hostname into staging too. This task is independent of the
infra/Argo CD registration work (T01–T03) and can run in parallel with it.

## What to do

- Move the current `workloads/webshop/*.yaml` into
  `workloads/webshop/base/`, keeping the existing `kustomization.yaml`
  there as the base (namespace `webshop`, image `ghcr.io/pm-example/webshop`
  unchanged).
- Add `workloads/webshop/overlays/prod/kustomization.yaml` that references
  `../../base` with no patches (prod keeps `shop.example.com`), and
  `workloads/webshop/overlays/staging/kustomization.yaml` that references
  `../../base` with a patch setting the Ingress host to
  `staging.shop.example.com`.
- Update `argocd/apps/webshop.yaml`'s `source.path` to
  `workloads/webshop/overlays/prod` so the existing prod Application keeps
  working unchanged.
- Update `.github/workflows/validate.yml` so `kustomize build | kubeconform`
  runs against both overlay paths, not the old flat path.

## Acceptance criteria

- [ ] `kustomize build workloads/webshop/overlays/prod` produces the same
      Ingress host (`shop.example.com`) as today
- [ ] `kustomize build workloads/webshop/overlays/staging` produces an
      Ingress host of `staging.shop.example.com` and is otherwise identical
      to the base
- [ ] `argocd/apps/webshop.yaml` points at the `overlays/prod` path and its
      Application still validates
- [ ] CI's `kubeconform` check passes for both overlay paths

## Out of scope

- Creating the staging `webshop` Application itself (T06).
- Any change to the Deployment or Service manifests' content.

## Notes

Evidence: [argocd/workloads/webshop/ingress.yaml:8],
[argocd/workloads/webshop/kustomization.yaml],
[argocd/.github/workflows/validate.yml:17].
<!-- pm:file staging-environment/tasks/T05-staging-ingress-nginx.md -->
---
id: T05
epic: staging-environment
milestone: M3
title: Add a staging ingress-nginx Argo CD Application
status: todo
priority: must
depends-on: [T03]
estimate: S
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T05 — Add a staging ingress-nginx Argo CD Application

## Context

`argocd/apps/ingress-nginx.yaml` is hardcoded to the prod load balancer
name (`prod-eu-ingress`, [argocd/apps/ingress-nginx.yaml:17-21]) and the
in-cluster destination — staging needs its own copy pointed at its own LB
and its own destination (registered in T03), or the staging webshop Ingress
(T06) will never get an address.

## What to do

- Add `argocd/apps/ingress-nginx-staging.yaml`, copied from
  `apps/ingress-nginx.yaml`, with:
  - `destination.server` set to the staging destination name/URL
    registered in T03
  - the LB annotation changed to `staging-eu-ingress` (matching the
    `ingress_lb_name` output from T01's staging environment)
  - a distinct Application `metadata.name` (e.g. `ingress-nginx-staging`)
    so it doesn't collide with the prod one in the `argocd` namespace

## Acceptance criteria

- [ ] `ingress-nginx-staging` Application exists, targets the staging
      destination, and is annotated with `staging-eu-ingress`
- [ ] Argo CD shows it Synced/Healthy
- [ ] The prod `ingress-nginx` Application is unaffected (still targets
      `prod-eu-ingress`, in-cluster)

## Out of scope

- The webshop Application itself (T06).
- Any ingress-nginx chart version change (stays at `4.11.3` as prod uses).

## Notes

Evidence: [argocd/apps/ingress-nginx.yaml].
<!-- pm:file staging-environment/tasks/T06-staging-webshop-application.md -->
---
id: T06
epic: staging-environment
milestone: M3
title: Add a staging webshop Argo CD Application
status: todo
priority: must
depends-on: [T03, T04, T05]
estimate: S
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T06 — Add a staging webshop Argo CD Application

## Context

This is the task the epic is actually about: getting the webshop running
on staging. It needs the staging destination (T03), the staging overlay
path (T04), and a working ingress controller on staging (T05) to all be in
place first — the last piece of M3.

## What to do

- Add `argocd/apps/webshop-staging.yaml`, copied from `apps/webshop.yaml`
  [argocd/apps/webshop.yaml], with:
  - `source.path` set to `workloads/webshop/overlays/staging` (from T04)
  - `destination.server` set to the staging destination from T03
  - `destination.namespace: webshop` (same as prod; different cluster, so
    no collision)
  - `targetRevision: main` and `syncPolicy.automated` (`prune`, `selfHeal`)
    kept, matching prod's auto-sync so staging always tracks `main`
  - a distinct Application `metadata.name` (e.g. `webshop-staging`)

## Acceptance criteria

- [ ] `webshop-staging` Application exists, targets the staging
      destination and the staging overlay path, and tracks `main` with
      auto-sync
- [ ] Argo CD shows it Synced/Healthy, with the Deployment/Service running
      in the staging cluster's `webshop` namespace
- [ ] The Ingress it creates requests host `staging.shop.example.com`
- [ ] The prod `webshop` Application is unaffected

## Out of scope

- DNS for `staging.shop.example.com` (external dependency, tracked in the
  plan).
- Any change to the webshop application image or Deployment resources.

## Notes

Evidence: [argocd/apps/webshop.yaml].
<!-- pm:file staging-environment/tasks/T07-validate-staging-first-workflow.md -->
---
id: T07
epic: staging-environment
milestone: M4
title: Validate the staging-first workflow end-to-end
status: todo
priority: must
depends-on: [T06]
estimate: S
owner: unassigned
updated: 2026-11-04
contract: 1
---

# T07 — Validate the staging-first workflow end-to-end

## Context

The epic's primary metric is "% of webshop prod syncs preceded by a staging
sync of the same revision" (`../epic.md`). Every prior task only builds the
plumbing; this task is where the hypothesis actually gets tested, and where
the epic's open question (who creates the DNS record) becomes a hard
blocker if still unresolved.

## What to do

- Confirm the external DNS dependency (`../plan.md` Dependencies table) is
  resolved: `staging.shop.example.com` resolves to the staging load
  balancer's IP.
- Push a small, observable change to webshop's `main` (or wait for the next
  real one) and confirm via Argo CD's sync history that `webshop-staging`
  syncs the revision; confirm `staging.shop.example.com` serves it.
- Record in this task's Notes (or a short runbook note in the `argocd`
  repo's README) how to check "did this revision hit staging before prod"
  going forward, so the practice survives past this epic.

## Acceptance criteria

- [ ] `staging.shop.example.com` resolves and serves the current webshop
      revision
- [ ] A specific git revision is confirmed, via Argo CD sync history, to
      have synced to `webshop-staging` at or before its sync to the prod
      `webshop` Application
- [ ] A short note exists (runbook or README addition) describing how to
      check staging-before-prod ordering for future releases

## Out of scope

- Building any tooling to enforce the ordering automatically (non-goal:
  no automated promotion gate).
- Creating the DNS record itself — only confirming it exists.

## Notes

If DNS is not yet resolved when this task is picked up, mark it `blocked`
with that as the recorded blocker rather than guessing at a workaround.
