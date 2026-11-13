# storefront

The customer-facing storefront: product pages and the cart. An Express
service listening on port 3000.

## Development

- `npm ci` installs the dependencies.
- `npm test` runs the tests.
- `npm run lint` checks the sources.

Run `npm test` and `npm run lint` before opening a pull request.

## Releases

Pushing a `v*` tag builds and pushes `ghcr.io/pm-example/storefront:<version>`.
The argocd repo deploys it: bump `newTag` in
`workloads/storefront/kustomization.yaml` there to roll a release out.
