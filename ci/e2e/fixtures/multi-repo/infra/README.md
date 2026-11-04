# infra

Terraform for the prod-eu platform on Hetzner Cloud: the private network, the
k3s cluster nodes and the load balancer in front of its ingress.

What runs on the cluster is defined in the argocd repo.

## Layout

- `modules/network`: private network and node subnet
- `modules/cluster`: k3s server nodes and the ingress load balancer
- `envs/prod`: the prod-eu root module; state lives in the `pm-example-tfstate` bucket
