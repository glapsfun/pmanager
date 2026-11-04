terraform {
  required_version = ">= 1.9"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }

  backend "s3" {
    bucket = "pm-example-tfstate"
    key    = "prod/terraform.tfstate"
    region = "eu-central"
  }
}

module "network" {
  source = "../../modules/network"
  name   = "prod-eu"
}

module "cluster" {
  source       = "../../modules/cluster"
  cluster_name = "prod-eu"
  network_id   = module.network.network_id
}

output "cluster_name" {
  value = module.cluster.cluster_name
}

output "ingress_lb_name" {
  value = module.cluster.ingress_lb_name
}
