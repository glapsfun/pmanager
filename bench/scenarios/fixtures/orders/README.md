# orders

The orders service stores customer orders and serves them over HTTP.

## Development

Run `make test` and `make lint` before every commit. `make release` builds and
pushes the service image for the version set in the Makefile.

## Layout

- `cmd/orders/` and `internal/`: the Go service.
- `infra/terraform/`: the service's own cloud resources.
- `deploy/chart/`: the service's Helm chart.
