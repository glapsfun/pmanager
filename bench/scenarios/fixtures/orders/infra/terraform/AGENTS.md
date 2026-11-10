# Agent instructions: infra/terraform

These are the orders service's own cloud resources.

Before every commit, run from this folder:

- `./scripts/tf-check.sh`: `terraform fmt -check`, `terraform validate`,
  `tflint` and `checkov`; all must pass.

Rules:

- Never run `terraform plan` or `terraform apply` against real state from a
  workstation. The platform pipeline posts the plan on the pull request and
  applies it after merge.
- One resource change per pull request.
