kv {
  path = "secret/"
  type = "kv"
  options = {
    version = 2
    max_versions = 10
    cas_required = false
  }
  description = "KV v2 secret engine for application secrets"
  seal_wrap = true
}

kubernetes {
  path = "kubernetes/"
  type = "kubernetes"
  description = "Kubernetes auth method for pod identity"
  kubernetes_host = "https://kubernetes.default.svc:443"
  kubernetes_ca_cert = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
  token_reviewer_jwt = "/var/run/secrets/kubernetes.io/serviceaccount/token"
}

policy "backend-app" {
  name        = "backend-app"
  rules       = <<-EOH
    path "secret/data/backend/*" {
      capabilities = ["read"]
    }
    path "secret/metadata/backend/*" {
      capabilities = ["list", "read"]
    }
    EOH
}

policy "db-credentials" {
  name        = "db-credentials"
  rules       = <<-EOH
    path "secret/data/database/*" {
      capabilities = ["read"]
    }
    path "secret/metadata/database/*" {
      capabilities = ["list", "read"]
    }
    EOH
}

policy "admin" {
  name        = "admin"
  rules       = <<-EOH
    path "secret/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }
    path "sys/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }
    EOH
}

policy "security-auditor" {
  name        = "security-auditor"
  rules       = <<-EOH
    path "secret/*" {
      capabilities = ["read", "list"]
    }
    path "secret/metadata/*" {
      capabilities = ["read", "list"]
    }
    path "sys/policies/acl/*" {
      capabilities = ["read", "list"]
    }
    path "sys/audit/*" {
      capabilities = ["read", "list"]
    }
    path "auth/*" {
      capabilities = ["read", "list"]
    }
    EOH
}

pki {
  path = "pki"
  type = "pki"
  description = "Internal PKI for mTLS certificates"
  config = {
    max_lease_ttl = "8760h"
    default_lease_ttl = "720h"
  }
  ca_cert = <<-EOC
    -----BEGIN CERTIFICATE-----
    MIICljCCAX4CCQCKz8X4B7BdzANBgkqhkiG9w0BAQsFADAlMRYwFAYDVQQKEw1h
    aG1lZGVsYmF6LkxNUzEUMBIGA1UEAxMLaW50ZXJuYWwtQ0EwHhcNMjQwMTAxMDAw
    MDAwWhcNMzQwMTAxMDAwMDAwWjAlMRYwFAYDVQQKEw1haG1lZGVsYmF6LkxNUzEU
    MBIGA1UEAxMLaW50ZXJuYWwtQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
    AoIBAQDN7EXAMPLECAKEYPLACEHOLDERFoRGeneratedCertOnlyuNvkEXAMPLE
    -----END CERTIFICATE-----
  EOC
  ca_key = <<-EOK
    -----BEGIN EC PRIVATE KEY-----
    MHcCAQEEIKxEXAMPLEGENERATEDKEYPLACEHOLDERFoRInternalCAoAoGCCqGSM49
    AwEHoUQDQgAEMFEXAMPLECAKEYPLACEHOLDERFoRGeneratedCertOnlyuNvkEXAMPLE
    -----END EC PRIVATE KEY-----
  EOK
}

pki_role "ahmedelbaz-server" {
  path      = "pki/roles/ahmedelbaz-server"
  role_name = "ahmedelbaz-server"
  allowed_domains = ["ahmedelbaz.qzz.io", "*.ahmedelbaz.qzz.io"]
  allow_bare_domains = true
  allow_subdomains = true
  allow_any_name = true
  allow_ip_sans = true
  allowed_uri_sans = ["spiffe://ahmedelbaz/*"]
  server_flag = true
  client_flag = true
  key_type = "ec"
  key_bits = 256
  max_ttl = "720h"
  ttl = "168h"
  generate_lease = false
}

audit "file" {
  type    = "file"
  path    = "/vault/audit/audit.log"
  format  = "json"
  log_raw = false
  prefix  = "vault-audit"
  mode    = "0640"
  hmac_accessor = ""
}
