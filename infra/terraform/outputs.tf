output "pages_project_name" {
  description = "Cloudflare Pages project name."
  value       = module.resilience_tabletop_lab.pages_project_name
}

output "pages_subdomain" {
  description = "Default Cloudflare Pages subdomain."
  value       = module.resilience_tabletop_lab.pages_subdomain
}

output "lab_url" {
  description = "Production standalone lab URL."
  value       = module.resilience_tabletop_lab.lab_url
}
