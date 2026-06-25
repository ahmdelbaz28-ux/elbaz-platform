#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARE_ACCOUNT_ID="951840a21847d5c55c8284d4ded7cffc"
CLOUDFLARE_ZONE_ID="93ccd466aeba31bc1f8bac061ab168e2"
NAMESPACE="ahmedelbaz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="${SCRIPT_DIR}/security-deployment-report-$(date +%Y%m%d-%H%M%S).txt"
PASSED=0
FAILED=0
WARNINGS=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$REPORT_FILE"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1" | tee -a "$REPORT_FILE"; PASSED=$((PASSED + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1" | tee -a "$REPORT_FILE"; FAILED=$((FAILED + 1)); }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$REPORT_FILE"; WARNINGS=$((WARNINGS + 1)); }

echo "======================================================" | tee -a "$REPORT_FILE"
echo "  Ahmed El-Baz LMS - Infrastructure Security Deploy  " | tee -a "$REPORT_FILE"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)                      " | tee -a "$REPORT_FILE"
echo "======================================================" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

log_info "Verifying Cloudflare API token..."
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    CF_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}")
    if [[ "$CF_RESPONSE" == "200" ]]; then
        log_pass "Cloudflare API token is valid"
    else
        log_fail "Cloudflare API token validation failed (HTTP $CF_RESPONSE)"
        exit 1
    fi
else
    log_warn "CLOUDFLARE_API_TOKEN not set - skipping Cloudflare API operations"
fi

log_info "Applying Kubernetes Network Policies..."
kubectl apply -f "${SCRIPT_DIR}/network-policies-v3-elite.yaml" --namespace "${NAMESPACE}" 2>&1 | tee -a "$REPORT_FILE"

log_info "Applying Pod Security Standards..."
kubectl apply -f "${SCRIPT_DIR}/pod-security-standards.yaml" 2>&1 | tee -a "$REPORT_FILE"

log_info "Applying RBAC Configuration..."
kubectl apply -f "${SCRIPT_DIR}/k8s-rbac-v2.yaml" 2>&1 | tee -a "$REPORT_FILE"

log_info "Deploying Kubernetes Audit Policy..."
kubectl apply -f "${SCRIPT_DIR}/siem-audit/kubernetes-audit-policy.yaml" 2>&1 | tee -a "$REPORT_FILE"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    log_info "Deploying WAF supplemental rules (reference)..."
    log_warn "WAF supplemental rules are for reference - free plan may not support all custom rules"
    log_info "See waf-rules-v3-supplemental.json for rule definitions"
fi

echo "" | tee -a "$REPORT_FILE"
echo "======================================================" | tee -a "$REPORT_FILE"
echo "  Security Verification Tests                        " | tee -a "$REPORT_FILE"
echo "======================================================" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

log_info "Running verification tests..."

echo "" | tee -a "$REPORT_FILE"
log_info "--- Network Policy Verification ---"

TEST1=$(kubectl get networkpolicy deny-all-default-ingress -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST1" ]]; then
    log_pass "Test 01: deny-all-default-ingress NetworkPolicy exists"
else
    log_fail "Test 01: deny-all-default-ingress NetworkPolicy not found"
fi

TEST2=$(kubectl get networkpolicy deny-all-default-egress -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST2" ]]; then
    log_pass "Test 02: deny-all-default-egress NetworkPolicy exists"
else
    log_fail "Test 02: deny-all-default-egress NetworkPolicy not found"
fi

TEST3=$(kubectl get networkpolicy backend-to-aiven-egress -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST3" ]]; then
    log_pass "Test 03: backend-to-aiven-egress NetworkPolicy exists"
else
    log_fail "Test 03: backend-to-aiven-egress NetworkPolicy not found"
fi

TEST4=$(kubectl get networkpolicy backend-to-resend-egress -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST4" ]]; then
    log_pass "Test 04: backend-to-resend-egress NetworkPolicy exists"
else
    log_fail "Test 04: backend-to-resend-egress NetworkPolicy not found"
fi

TEST5=$(kubectl get networkpolicy backend-only-redis -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST5" ]]; then
    log_pass "Test 05: backend-only-redis NetworkPolicy exists"
else
    log_fail "Test 05: backend-only-redis NetworkPolicy not found"
fi

TEST6=$(kubectl get networkpolicy deny-cross-namespace-ingress -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST6" ]]; then
    log_pass "Test 06: deny-cross-namespace-ingress NetworkPolicy exists"
else
    log_fail "Test 06: deny-cross-namespace-ingress NetworkPolicy not found"
fi

NP_COUNT=$(kubectl get networkpolicies -n "${NAMESPACE}" --no-headers 2>/dev/null | wc -l || echo "0")
if [[ "$NP_COUNT" -ge 10 ]]; then
    log_pass "Test 07: NetworkPolicy count is $NP_COUNT (minimum 10 required)"
else
    log_fail "Test 07: NetworkPolicy count is $NP_COUNT (expected at least 10)"
fi

echo "" | tee -a "$REPORT_FILE"
log_info "--- Pod Security Verification ---"

TEST8=$(kubectl get namespace "${NAMESPACE}" -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null || echo "")
if [[ "$TEST8" == "restricted" ]]; then
    log_pass "Test 08: Pod Security enforce label set to restricted"
else
    log_fail "Test 08: Pod Security enforce label is '$TEST8' (expected restricted)"
fi

TEST9=$(kubectl get namespace "${NAMESPACE}" -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/audit}' 2>/dev/null || echo "")
if [[ "$TEST9" == "restricted" ]]; then
    log_pass "Test 09: Pod Security audit label set to restricted"
else
    log_fail "Test 09: Pod Security audit label is '$TEST9' (expected restricted)"
fi

echo "" | tee -a "$REPORT_FILE"
log_info "--- RBAC Verification ---"

TEST10=$(kubectl get role backend-app -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST10" ]]; then
    log_pass "Test 10: backend-app Role exists"
else
    log_fail "Test 10: backend-app Role not found"
fi

TEST11=$(kubectl get clusterrole log-collector -o name 2>/dev/null || echo "")
if [[ -n "$TEST11" ]]; then
    log_pass "Test 11: log-collector ClusterRole exists"
else
    log_fail "Test 11: log-collector ClusterRole not found"
fi

TEST12=$(kubectl get clusterrole security-auditor -o name 2>/dev/null || echo "")
if [[ -n "$TEST12" ]]; then
    log_pass "Test 12: security-auditor ClusterRole exists"
else
    log_fail "Test 12: security-auditor ClusterRole not found"
fi

TEST13=$(kubectl get serviceaccount backend-app -n "${NAMESPACE}" -o name 2>/dev/null || echo "")
if [[ -n "$TEST13" ]]; then
    log_pass "Test 13: backend-app ServiceAccount exists"
else
    log_fail "Test 13: backend-app ServiceAccount not found"
fi

SA_COUNT=$(kubectl get serviceaccounts -n "${NAMESPACE}" --no-headers 2>/dev/null | wc -l || echo "0")
if [[ "$SA_COUNT" -ge 4 ]]; then
    log_pass "Test 14: ServiceAccount count is $SA_COUNT (minimum 4 required)"
else
    log_fail "Test 14: ServiceAccount count is $SA_COUNT (expected at least 4)"
fi

echo "" | tee -a "$REPORT_FILE"
log_info "--- Cloudflare WAF Verification ---"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    WAF_RESPONSE=$(curl -s -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/rulesets" 2>/dev/null || echo "{}")
    WAF_COUNT=$(echo "$WAF_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data.get('result',[])))" 2>/dev/null || echo "0")
    if [[ "$WAF_COUNT" -gt 0 ]]; then
        log_pass "Test 15: WAF rulesets active - $WAF_COUNT ruleset(s) found"
    else
        log_warn "Test 15: No WAF rulesets found (check Cloudflare dashboard)"
    fi

    echo "" | tee -a "$REPORT_FILE"
    log_info "--- DDoS Protection Verification ---"

    DDOS_RESPONSE=$(curl -s -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/ddos" 2>/dev/null || echo "{}")
    if echo "$DDOS_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); sys.exit(0 if data.get('success',False) else 1)" 2>/dev/null; then
        log_pass "Test 16: DDoS protection API accessible"
    else
        log_warn "Test 16: Could not verify DDoS protection status via API"
    fi
else
    log_warn "Test 15: Skipped - CLOUDFLARE_API_TOKEN not set"
    log_warn "Test 16: Skipped - CLOUDFLARE_API_TOKEN not set"
fi

echo "" | tee -a "$REPORT_FILE"
log_info "--- DNS Verification ---"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    DNS_RESPONSE=$(curl -s -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=ahmedelbaz.qzz.io" 2>/dev/null || echo "{}")
    DNS_COUNT=$(echo "$DNS_RESPONSE" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data.get('result',[])))" 2>/dev/null || echo "0")
    if [[ "$DNS_COUNT" -gt 0 ]]; then
        log_pass "Test 17: DNS records found for ahmedelbaz.qzz.io ($DNS_COUNT record(s))"
    else
        log_fail "Test 17: No DNS records found for ahmedelbaz.qzz.io"
    fi
else
    log_warn "Test 17: Skipped - CLOUDFLARE_API_TOKEN not set"
fi

echo "" | tee -a "$REPORT_FILE"
log_info "--- Rate Limiting Verification ---"

RATE_LIMIT_FILE="${SCRIPT_DIR}/ddos-protection.json"
if [[ -f "$RATE_LIMIT_FILE" ]]; then
    RATE_RULES=$(python3 -c "
import json
with open('$RATE_LIMIT_FILE') as f:
    data = json.load(f)
rules = data.get('rate_limiting', {}).get('rules', [])
print(len(rules))
" 2>/dev/null || echo "0")
    if [[ "$RATE_RULES" -ge 5 ]]; then
        log_pass "Test 18: Rate limiting rules configured - $RATE_RULES rule(s)"
    else
        log_fail "Test 18: Only $RATE_RULES rate limiting rule(s) configured (expected at least 5)"
    fi
else
    log_fail "Test 18: ddos-protection.json not found"
fi

echo "" | tee -a "$REPORT_FILE"
log_info "--- Audit Policy Verification ---"

TEST19=$(kubectl get clusterrolebinding security-auditor -o name 2>/dev/null || echo "")
if [[ -n "$TEST19" ]]; then
    log_pass "Test 19: security-auditor ClusterRoleBinding exists"
else
    log_fail "Test 19: security-auditor ClusterRoleBinding not found"
fi

echo "" | tee -a "$REPORT_FILE"
echo "======================================================" | tee -a "$REPORT_FILE"
echo "  Deployment Summary                               " | tee -a "$REPORT_FILE"
echo "======================================================" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"
TOTAL=$((PASSED + FAILED + WARNINGS))
echo "Total Tests:  $TOTAL" | tee -a "$REPORT_FILE"
echo -e "Passed:       ${GREEN}${PASSED}${NC}" | tee -a "$REPORT_FILE"
echo -e "Failed:       ${RED}${FAILED}${NC}" | tee -a "$REPORT_FILE"
echo -e "Warnings:     ${YELLOW}${WARNINGS}${NC}" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}STATUS: DEPLOYMENT HAS FAILURES - Review failed tests above${NC}" | tee -a "$REPORT_FILE"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}STATUS: DEPLOYED WITH WARNINGS - Review warnings above${NC}" | tee -a "$REPORT_FILE"
    exit 0
else
    echo -e "${GREEN}STATUS: ALL SECURITY CONTROLS DEPLOYED SUCCESSFULLY${NC}" | tee -a "$REPORT_FILE"
    exit 0
fi
