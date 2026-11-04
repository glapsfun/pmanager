# Agent instructions

Before every commit:

- `terraform fmt -recursive`
- `terraform -chdir=envs/prod init -backend=false && terraform -chdir=envs/prod validate`
- `tflint --recursive`

Rules:

- Never run `terraform plan` or `terraform apply` against real state from a
  workstation. CI posts the plan on the pull request and applies after merge.
- Branch names: `infra/<short-topic>`. One module change per pull request.
- The `cluster_name` and `ingress_lb_name` outputs are used by the argocd repo.
  Renaming or removing one needs the matching argocd change merged first.
