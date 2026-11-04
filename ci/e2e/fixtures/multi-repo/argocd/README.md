# argocd

Argo CD app-of-apps for the prod-eu cluster. Argo CD syncs `apps/` from
`main`; each Application there points at a chart or a path in this repo.

The cluster, its network and the ingress load balancer come from the infra
repo (`envs/prod`). The webshop image comes from the webshop repo's
releases.
