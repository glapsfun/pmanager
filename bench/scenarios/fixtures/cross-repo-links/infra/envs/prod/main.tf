terraform {
  required_version = ">= 1.9"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "pm-example-tfstate"
    key    = "prod/terraform.tfstate"
    region = "eu-central"
  }
}

provider "aws" {
  region = "eu-central"

  endpoints {
    s3 = "https://objects.eu-central.example.invalid"
  }

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true
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
