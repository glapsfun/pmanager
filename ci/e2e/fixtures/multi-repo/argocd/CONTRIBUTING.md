# Contributing

- Every change goes through a pull request. Argo CD syncs `main` on merge.
- Never `kubectl apply` or edit live objects by hand. Argo CD reverts drift
  (`selfHeal: true`).
- Pin chart versions in `apps/*.yaml`. No `*` or ranges.
