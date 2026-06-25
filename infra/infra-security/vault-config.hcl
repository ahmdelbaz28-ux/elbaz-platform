listener "tcp" {
  address       = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_cert_file = "/etc/vault/tls/vault.crt"
  tls_key_file  = "/etc/vault/tls/vault.key"
  tls_min_version = "tls12"
  tls_client_ca_file = "/etc/vault/tls/ca.crt"
  max_request_size = 33554432
  max_request_duration = "90s"
}

storage "file" {
  path = "/vault/data"
}

seal "transit" {
  address            = "https://vault-seal.internal:8200"
  key_name           = "ahmedelbaz-unseal-key"
  mount_path         = "transit/"
  disable_renewal    = false
  tls_skip_verify    = false
}

telemetry {
  prometheus_retention_time = "30s"
  disable_hostname          = true
  statsite_address          = ""
  statsd_address            = ""
}

api_addr = "https://vault.ahmedelbaz.qzz.io:8200"
cluster_addr = "https://vault-internal.ahmedelbaz.qzz.io:8201"

ui = true

log_level = "info"

disable_mlock = false
api_idle_timeout = "5m"
