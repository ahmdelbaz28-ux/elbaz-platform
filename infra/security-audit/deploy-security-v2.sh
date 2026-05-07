#!/usr/bin/env bash
set -euo pipefail

CF_TOKEN="cfat_pZ12cmHVikV4WE99ABdG2GdmVUgxbfeX95wVeqzMc8ad6926"
ZONE_ID="93ccd466aeba31bc1f8bac061ab168e2"
ACCOUNT_ID="951840a21847d5c55c8284d4ded7cffc"
BASE_URL="https://api.cloudflare.com/client/v4"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"; }

cf_get() {
  local endpoint="$1"
  local response
  response=$(curl -s -w "\n%{http_code}" -X GET \
    "${BASE_URL}${endpoint}" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json")
  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" -ge 400 ]; then
    log_error "GET ${endpoint} failed with HTTP ${http_code}"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    return 1
  fi
  echo "$body"
}

cf_post() {
  local endpoint="$1"
  local data="$2"
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST \
    "${BASE_URL}${endpoint}" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$data")
  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" -ge 400 ]; then
    log_error "POST ${endpoint} failed with HTTP ${http_code}"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    return 1
  fi
  echo "$body"
}

cf_delete() {
  local endpoint="$1"
  local response
  response=$(curl -s -w "\n%{http_code}" -X DELETE \
    "${BASE_URL}${endpoint}" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json")
  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" -ge 400 ]; then
    log_error "DELETE ${endpoint} failed with HTTP ${http_code}"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    return 1
  fi
  echo "$body"
}

verify_token() {
  log_info "Verifying Cloudflare API token..."
  local result
  result=$(cf_get "/user/tokens/verify") || {
    log_error "Token verification failed. Please check your API token."
    exit 1
  }
  local status
  status=$(echo "$result" | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['status'])" 2>/dev/null)
  if [ "$status" = "active" ]; then
    log_success "API token is valid and active"
  else
    log_error "Token status: ${status}. Expected 'active'."
    exit 1
  fi
  local token_id
  token_id=$(echo "$result" | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null)
  log_info "Token ID: ${token_id}"
}

deploy_waf_rules() {
  log_info "========================================="
  log_info "Starting WAF Rules Deployment"
  log_info "========================================="

  local waf_file="${SCRIPT_DIR}/waf-rules-v2-owasp10.json"
  if [ ! -f "$waf_file" ]; then
    log_error "WAF rules file not found: ${waf_file}"
    exit 1
  fi

  local rule_count
  rule_count=$(python3 -c "import json; print(len(json.load(open('${waf_file}'))))")
  log_info "Found ${rule_count} WAF rules to deploy"

  log_info "Fetching existing custom firewall rules..."
  local existing_rules
  existing_rules=$(cf_get "/zones/${ZONE_ID}/rulesets") || {
    log_warn "Could not fetch existing rulesets"
  }

  log_info "Checking for existing custom rules..."
  local existing_custom_rules
  existing_custom_rules=$(cf_get "/zones/${ZONE_ID}/rulesets" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for rs in data.get('result', []):
    if rs.get('kind') == 'custom' and rs.get('phase') == 'http_request_firewall_custom':
        print(rs['id'])
        break
" 2>/dev/null) || true

  if [ -n "$existing_custom_rules" ] && [ "$existing_custom_rules" != "" ]; then
    log_info "Found existing custom ruleset: ${existing_custom_rules}"
    log_info "Fetching existing rules within ruleset..."
    local rules_list
    rules_list=$(cf_get "/zones/${ZONE_ID}/rulesets/${existing_custom_rules}/rules" | python3 -c "
import sys, json
data = json.load(sys.stdin)
rules = data.get('result', [])
for r in rules:
    print(r.get('id', ''))
" 2>/dev/null) || true

    if [ -n "$rules_list" ]; then
      while IFS= read -r rule_id; do
        if [ -n "$rule_id" ]; then
          log_info "Deleting existing rule: ${rule_id}"
          cf_delete "/zones/${ZONE_ID}/rulesets/${existing_custom_rules}/rules/${rule_id}" > /dev/null 2>&1 || log_warn "Failed to delete rule ${rule_id}"
        fi
      done <<< "$rules_list"
    fi
  else
    log_info "No existing custom ruleset found. Creating new one..."
    local create_result
    create_result=$(cf_post "/zones/${ZONE_ID}/rulesets" '{
      "name": "ahmedelbaz-security-custom-rules",
      "description": "Custom firewall rules for ahmedelbaz.qzz.io - OWASP Top 10 protection",
      "kind": "custom",
      "phase": "http_request_firewall_custom"
    }') || {
      log_error "Failed to create custom ruleset"
      exit 1
    }
    existing_custom_rules=$(echo "$create_result" | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['id'])" 2>/dev/null)
    log_success "Created new custom ruleset: ${existing_custom_rules}"
  fi

  log_info "Deploying ${rule_count} WAF rules..."
  local rule_batch
  rule_batch=$(python3 -c "
import json

with open('${waf_file}') as f:
    rules = json.load(f)

batch = []
for i, rule in enumerate(rules):
    batch.append({
        'expression': rule['expression'],
        'description': rule['description'],
        'action': rule['action'],
        'enabled': True,
        'ref': rule['filter']['id']
    })

output = {'rules': batch}
print(json.dumps(output))
")

  local deploy_result
  deploy_result=$(cf_put "/zones/${ZONE_ID}/rulesets/${existing_custom_rules}/rules" "$rule_batch") || {
    log_error "Failed to deploy WAF rules"
    return 1
  }

  local deployed_count
  deployed_count=$(echo "$deploy_result" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('result', [])))" 2>/dev/null || echo "0")
  log_success "Successfully deployed ${deployed_count} WAF rules"
}

cf_put() {
  local endpoint="$1"
  local data="$2"
  local response
  response=$(curl -s -w "\n%{http_code}" -X PUT \
    "${BASE_URL}${endpoint}" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$data")
  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" -ge 400 ]; then
    log_error "PUT ${endpoint} failed with HTTP ${http_code}"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    return 1
  fi
  echo "$body"
}

deploy_dns_records() {
  log_info "========================================="
  log_info "Starting DNS Records Deployment"
  log_info "========================================="

  local dns_file="${SCRIPT_DIR}/dns-security-config.json"
  if [ ! -f "$dns_file" ]; then
    log_error "DNS config file not found: ${dns_file}"
    exit 1
  fi

  local record_count
  record_count=$(python3 -c "import json; print(len(json.load(open('${dns_file}'))))")
  log_info "Found ${record_count} DNS records to deploy"

  log_info "Fetching existing DNS records..."
  local existing_dns
  existing_dns=$(cf_get "/zones/${ZONE_ID}/dns_records?per_page=100")

  python3 << 'PYTHON_SCRIPT'
import json
import subprocess
import sys

DNS_FILE = "${SCRIPT_DIR}/dns-security-config.json"
CF_TOKEN = "${CF_TOKEN}"
ZONE_ID = "${ZONE_ID}"
BASE_URL = "https://api.cloudflare.com/client/v4"

with open("${SCRIPT_DIR}/dns-security-config.json") as f:
    records = json.load(f)

existing_result = subprocess.run(
    ["curl", "-s", "-X", "GET",
     f"{BASE_URL}/zones/{ZONE_ID}/dns_records?per_page=100",
     "-H", f"Authorization: Bearer {CF_TOKEN}",
     "-H", "Content-Type: application/json"],
    capture_output=True, text=True
)

existing_data = json.loads(existing_result.stdout)
existing_records = existing_data.get('result', [])

for record in records:
    name = record['name']
    rtype = record['type']
    print(f"  Processing {rtype} record: {name}")

    found = False
    for existing in existing_records:
        if existing.get('name') == name and existing.get('type') == rtype:
            found = True
            rec_id = existing['id']
            print(f"    Found existing {rtype} record (ID: {rec_id}), updating...")

            update_payload = {}
            if rtype == 'CAA':
                update_payload = {
                    'type': rtype,
                    'name': name,
                    'data': record['data'],
                    'ttl': record['ttl']
                }
            else:
                update_payload = {
                    'type': rtype,
                    'name': name,
                    'content': record['content'],
                    'ttl': record['ttl']
                }

            patch_result = subprocess.run(
                ["curl", "-s", "-w", "\n%{http_code}", "-X", "PATCH",
                 f"{BASE_URL}/zones/{ZONE_ID}/dns_records/{rec_id}",
                 "-H", f"Authorization: Bearer {CF_TOKEN}",
                 "-H", "Content-Type: application/json",
                 "-d", json.dumps(update_payload)],
                capture_output=True, text=True
            )
            lines = patch_result.stdout.strip().split('\n')
            http_code = lines[-1]
            body = '\n'.join(lines[:-1])

            if int(http_code) < 400:
                print(f"    \033[0;32m[OK]\033[0m Updated {rtype} record: {name}")
            else:
                print(f"    \033[0;31m[ERROR]\033[0m Failed to update {rtype} record: {name} (HTTP {http_code})")
                print(f"    {body[:200]}")
            break

    if not found:
        print(f"    No existing {rtype} record found, creating...")

        create_payload = {}
        if rtype == 'CAA':
            create_payload = {
                'type': rtype,
                'name': name,
                'data': record['data'],
                'ttl': record['ttl']
            }
        else:
            create_payload = {
                'type': rtype,
                'name': name,
                'content': record['content'],
                'ttl': record['ttl'],
                'proxied': record.get('proxied', False)
            }

        create_result = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "-X", "POST",
             f"{BASE_URL}/zones/{ZONE_ID}/dns_records",
             "-H", f"Authorization: Bearer {CF_TOKEN}",
             "-H", "Content-Type: application/json",
             "-d", json.dumps(create_payload)],
            capture_output=True, text=True
        )
        lines = create_result.stdout.strip().split('\n')
        http_code = lines[-1]
        body = '\n'.join(lines[:-1])

        if int(http_code) < 400:
            new_id = json.loads(body).get('result', {}).get('id', 'unknown')
            print(f"    \033[0;32m[OK]\033[0m Created {rtype} record: {name} (ID: {new_id})")
        else:
            print(f"    \033[0;31m[ERROR]\033[0m Failed to create {rtype} record: {name} (HTTP {http_code})")
            print(f"    {body[:200]}")

PYTHON_SCRIPT

  log_success "DNS records deployment completed"
}

run_verification() {
  log_info "========================================="
  log_info "Running Verification Tests"
  log_info "========================================="

  local passed=0
  local failed=0
  local total=0

  log_info "Test 1: Token validation..."
  total=$((total + 1))
  local token_check
  token_check=$(cf_get "/user/tokens/verify" | python3 -c "import sys, json; print(json.load(sys.stdin)['result']['status'])" 2>/dev/null)
  if [ "$token_check" = "active" ]; then
    log_success "Test 1 PASSED: Token is valid"
    passed=$((passed + 1))
  else
    log_error "Test 1 FAILED: Token invalid"
    failed=$((failed + 1))
  fi

  log_info "Test 2: Zone accessibility..."
  total=$((total + 1))
  local zone_check
  zone_check=$(cf_get "/zones/${ZONE_ID}" | python3 -c "import sys, json; d=json.load(sys.stdin)['result']; print(d['name'])" 2>/dev/null)
  if [ "$zone_check" = "ahmedelbaz.qzz.io" ]; then
    log_success "Test 2 PASSED: Zone accessible"
    passed=$((passed + 1))
  else
    log_error "Test 2 FAILED: Zone not accessible"
    failed=$((failed + 1))
  fi

  log_info "Test 3: DNS SPF record..."
  total=$((total + 1))
  local spf_check
  spf_check=$(cf_get "/zones/${ZONE_ID}/dns_records?name=ahmedelbaz.qzz.io&type=TXT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('result', []):
    if 'v=spf1' in r.get('content', ''):
        print('found')
        break
else:
    print('not found')
" 2>/dev/null)
  if [ "$spf_check" = "found" ]; then
    log_success "Test 3 PASSED: SPF record exists"
    passed=$((passed + 1))
  else
    log_warn "Test 3 WARNING: SPF record not found (may need propagation)"
    failed=$((failed + 1))
  fi

  log_info "Test 4: DNS DMARC record..."
  total=$((total + 1))
  local dmarc_check
  dmarc_check=$(cf_get "/zones/${ZONE_ID}/dns_records?name=_dmarc.ahmedelbaz.qzz.io&type=TXT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('result', []):
    if 'v=DMARC1' in r.get('content', ''):
        print('found')
        break
else:
    print('not found')
" 2>/dev/null)
  if [ "$dmarc_check" = "found" ]; then
    log_success "Test 4 PASSED: DMARC record exists"
    passed=$((passed + 1))
  else
    log_warn "Test 4 WARNING: DMARC record not found (may need propagation)"
    failed=$((failed + 1))
  fi

  log_info "Test 5: DNS CAA record..."
  total=$((total + 1))
  local caa_check
  caa_check=$(cf_get "/zones/${ZONE_ID}/dns_records?name=ahmedelbaz.qzz.io&type=CAA" | python3 -c "
import sys, json
data = json.load(sys.stdin)
records = data.get('result', [])
if len(records) > 0:
    print('found')
else:
    print('not found')
" 2>/dev/null)
  if [ "$caa_check" = "found" ]; then
    log_success "Test 5 PASSED: CAA record exists"
    passed=$((passed + 1))
  else
    log_warn "Test 5 WARNING: CAA record not found"
    failed=$((failed + 1))
  fi

  log_info "Test 6: WAF custom ruleset..."
  total=$((total + 1))
  local waf_check
  waf_check=$(cf_get "/zones/${ZONE_ID}/rulesets" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for rs in data.get('result', []):
    if rs.get('kind') == 'custom' and rs.get('phase') == 'http_request_firewall_custom':
        print(rs['id'])
        break
else:
    print('not found')
" 2>/dev/null)
  if [ "$waf_check" != "not found" ] && [ -n "$waf_check" ]; then
    log_success "Test 6 PASSED: Custom WAF ruleset exists (${waf_check})"
    passed=$((passed + 1))
  else
    log_warn "Test 6 WARNING: Custom WAF ruleset not found"
    failed=$((failed + 1))
  fi

  log_info "Test 7: HTTPS enforcement check..."
  total=$((total + 1))
  local https_check
  https_check=$(cf_get "/zones/${ZONE_ID}/settings/ssl" | python3 -c "
import sys, json
data = json.load(sys.stdin)['result']
print(data.get('value', 'off'))
" 2>/dev/null)
  if [ "$https_check" = "full" ] || [ "$https_check" = "full_strict" ]; then
    log_success "Test 7 PASSED: SSL mode is ${https_check}"
    passed=$((passed + 1))
  else
    log_warn "Test 7 INFO: SSL mode is '${https_check}', consider setting to 'full'"
    failed=$((failed + 1))
  fi

  log_info "Test 8: Zone plan verification..."
  total=$((total + 1))
  local plan_check
  plan_check=$(cf_get "/zones/${ZONE_ID}" | python3 -c "
import sys, json
data = json.load(sys.stdin)['result']
print(data.get('plan', {}).get('name', 'unknown'))
" 2>/dev/null)
  if [ -n "$plan_check" ]; then
    log_success "Test 8 PASSED: Zone plan is '${plan_check}'"
    passed=$((passed + 1))
  else
    log_warn "Test 8 WARNING: Could not determine zone plan"
    failed=$((failed + 1))
  fi

  echo ""
  log_info "========================================="
  log_info "Verification Results: ${passed}/${total} passed, ${failed} failed"
  log_info "========================================="

  if [ "$failed" -gt 0 ]; then
    log_warn "Some tests failed or need attention. Review the output above."
  else
    log_success "All verification tests passed!"
  fi
}

main() {
  echo ""
  echo "================================================"
  echo "  Ahmed El-Baz Security Deployment v2"
  echo "  Zone: ahmedelbaz.qzz.io"
  echo "  Zone ID: ${ZONE_ID}"
  echo "  Account ID: ${ACCOUNT_ID}"
  echo "  Date: $(date '+%Y-%m-%d %H:%M:%S UTC')"
  echo "================================================"
  echo ""

  verify_token

  echo ""
  deploy_waf_rules

  echo ""
  deploy_dns_records

  echo ""
  run_verification

  echo ""
  log_success "Deployment complete!"
  echo ""
}

main "$@"
