provider "cloudflare" {}

module "resilience_tabletop_lab" {
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/cloudflare-pages-lab?ref=main"

  cloudflare_account_id = var.cloudflare_account_id
  cloudflare_zone_id    = var.cloudflare_zone_id
  state_kv_namespace_id = var.state_kv_namespace_id
  pages_project_name    = "0trust-lab-resilience-tabletop"
  subdomain_prefix      = "lab-resilience-tabletop"

  plain_env_vars = {
    ENVIRONMENT = var.environment
  }
}
