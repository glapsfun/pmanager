terraform {
  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
    }
  }
}

variable "cluster_name" {
  type = string
}

variable "network_id" {
  type = number
}

variable "server_count" {
  type    = number
  default = 3
}

resource "hcloud_server" "server" {
  count       = var.server_count
  name        = "${var.cluster_name}-server-${count.index}"
  server_type = "cpx31"
  image       = "ubuntu-24.04"
  location    = "fsn1"

  network {
    network_id = var.network_id
  }
}

# ingress-nginx in the argocd repo attaches to this load balancer by name.
resource "hcloud_load_balancer" "ingress" {
  name               = "${var.cluster_name}-ingress"
  load_balancer_type = "lb11"
  location           = "fsn1"
}

output "cluster_name" {
  value = var.cluster_name
}

output "ingress_lb_name" {
  value = hcloud_load_balancer.ingress.name
}
