# PManager memo

_Last updated: 2026-10-19_

## 1. Product context

The webshop is a Go HTTP service (`webshop` repo) that customers use to buy
from the shop. It runs on the prod-eu k3s cluster, which the `infra` repo
provisions, and is deployed by an Argo CD app-of-apps in the `argocd` repo.

## 2. Business goals & north star

| Goal | Metric / north star | Source |
| :--- | :--- | :--- |
| Releases without customer-facing errors | 5xx responses during a rollout | [user, 2026-10-19] |

## 3. Stakeholders

| Who | Cares about | Consulted via |
| :--- | :--- | :--- |
| webshop repo owners | the service and its releases | #webshop channel |
| infra repo owners | the cluster and its network | #infra channel |
| argocd repo owners | Applications, workloads and sync health | #argocd channel |

## 4. Conventions & constraints

- `manager` (this repo): planning docs only; `bun run lint` and `bun test` before committing here.

## 5. Changelog

Rendered from `docs/pm/log/` by `pm render`; never edit between the markers.
Each run writes one log file instead of a line here.

<!-- pm:log:start -->
- none yet
<!-- pm:log:end -->
