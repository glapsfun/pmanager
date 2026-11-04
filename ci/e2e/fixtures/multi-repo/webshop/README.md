# webshop

The shop's HTTP service. It listens on port 8080.

## Development

- `make test` runs the unit tests (`go test ./...`).
- `make lint` runs `golangci-lint`.
- `make image` builds the container image.

Run `make test` and `make lint` before opening a pull request.

## Releases

Pushing a `v*` tag builds and pushes `ghcr.io/pm-example/webshop:<version>`.
The argocd repo deploys it: bump `newTag` in
`workloads/webshop/kustomization.yaml` there to roll a release out.
