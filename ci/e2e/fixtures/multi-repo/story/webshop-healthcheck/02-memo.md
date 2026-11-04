<!-- pm:file pmanager-memo.md -->
# PManager memo

_Last updated: 2026-10-20_

## 1. Product context

The webshop is a Go HTTP service (`webshop` repo) that customers use to buy
from the shop. It runs on the prod-eu k3s cluster and is deployed by an Argo
CD app-of-apps in the `argocd` repo, which pins the image tag the webshop
repo's release workflow publishes.

## 2. Business goals & north star

| Goal | Metric / north star | Source |
| :--- | :--- | :--- |
| Releases without customer-facing errors | 5xx responses during a rollout | [user, 2026-10-20] |

## 3. Stakeholders

| Who | Cares about | Consulted via |
| :--- | :--- | :--- |
| webshop repo owners | the service, its tests and releases | PR review in webshop |
| argocd repo owners | Applications, workloads and sync health | PR review in argocd |

## 4. Conventions & constraints

- `webshop`: `make test` (`go test ./...`) and `make lint` (`golangci-lint`) before a pull request; a `v*` tag publishes `ghcr.io/pm-example/webshop:<version>`.
- `argocd`: every change goes through a pull request and Argo CD syncs `main`; never `kubectl apply` by hand; pin chart versions; CI runs `yamllint -s .` and `kustomize build | kubeconform -strict`.
- `webshop` to `argocd`: a release reaches the cluster only when `newTag` is bumped in `workloads/webshop/kustomization.yaml`.
- `manager` (this repo): planning docs only; `bun run lint` and `bun test` before committing here.

## 5. Changelog

Rendered from `docs/pm/log/` by `pm render`; never edit between the markers.
Each run writes one log file instead of a line here.

<!-- pm:log:start -->
- none yet
<!-- pm:log:end -->
