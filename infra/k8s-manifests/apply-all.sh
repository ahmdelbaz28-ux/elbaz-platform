#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="ahmedelbaz"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_kubectl() {
    if ! command -v kubectl &>/dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    log_info "kubectl found: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null)"
}

check_cluster() {
    if ! kubectl cluster-info &>/dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    log_info "Connected to cluster: $(kubectl config current-context)"
}

apply_manifest() {
    local file="$1"
    local basename
    basename=$(basename "$file")
    if kubectl apply -f "$file"; then
        log_info "Applied: ${basename}"
    else
        log_error "Failed to apply: ${basename}"
        return 1
    fi
}

wait_for_namespace() {
    log_info "Waiting for namespace ${NAMESPACE} to be ready..."
    kubectl wait --for=condition=Active namespace/"${NAMESPACE}" --timeout=60s 2>/dev/null || true
    log_info "Namespace ${NAMESPACE} is active"
}

verify_deployments() {
    log_info "Verifying deployments..."
    local deployments=("backend" "frontend")
    for dep in "${deployments[@]}"; do
        if kubectl get deployment "${dep}" -n "${NAMESPACE}" &>/dev/null; then
            READY=$(kubectl get deployment "${dep}" -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}')
            DESIRED=$(kubectl get deployment "${dep}" -n "${NAMESPACE}" -o jsonpath='{.spec.replicas}')
            log_info "  ${dep}: ${READY:-0}/${DESIRED} replicas ready"
        else
            log_warn "  ${dep}: not found"
        fi
    done
}

verify_services() {
    log_info "Verifying services..."
    kubectl get services -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | while read -r line; do
        log_info "  ${line}"
    done
}

verify_statefulsets() {
    log_info "Verifying StatefulSets..."
    if kubectl get statefulset redis -n "${NAMESPACE}" &>/dev/null; then
        READY=$(kubectl get statefulset redis -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}')
        DESIRED=$(kubectl get statefulset redis -n "${NAMESPACE}" -o jsonpath='{.spec.replicas}')
        log_info "  redis: ${READY:-0}/${DESIRED} replicas ready"
    fi
}

verify_ingress() {
    log_info "Verifying Ingress..."
    if kubectl get ingress ahmedelbaz-ingress -n "${NAMESPACE}" &>/dev/null; then
        HOST=$(kubectl get ingress ahmedelbaz-ingress -n "${NAMESPACE}" -o jsonpath='{.spec.rules[0].host}')
        log_info "  Ingress host: ${HOST}"
    fi
}

verify_network_policies() {
    log_info "Verifying NetworkPolicies..."
    kubectl get networkpolicies -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | while read -r line; do
        log_info "  ${line}"
    done
}

verify_cronjobs() {
    log_info "Verifying CronJobs..."
    kubectl get cronjobs -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | while read -r line; do
        log_info "  ${line}"
    done
}

verify_pods_health() {
    log_info "Checking pod health..."
    local unhealthy=0
    kubectl get pods -n "${NAMESPACE}" -o json 2>/dev/null | \
    jq -r '.items[] | "\(.metadata.name) \(.status.phase)"' 2>/dev/null | \
    while read -r name phase; do
        if [ "${phase}" != "Running" ] && [ "${phase}" != "Succeeded" ]; then
            log_warn "  Pod ${name}: ${phase}"
            unhealthy=1
        fi
    done || true
    if [ "${unhealthy}" -eq 0 ]; then
        log_info "  All pods healthy"
    fi
}

main() {
    echo "============================================"
    echo " Ahmed El-Baz LMS - K8s Manifest Deployment"
    echo "============================================"
    echo ""

    check_kubectl
    check_cluster

    MANIFESTS=(
        "00-namespace.yaml"
        "01-secrets.yaml"
        "02-configmap.yaml"
        "21-service-accounts.yaml"
        "16-rbac.yaml"
        "16a-rolebindings.yaml"
        "03-backend-deployment.yaml"
        "04-frontend-deployment.yaml"
        "05-services.yaml"
        "14-redis-statefulset.yaml"
        "15-redis-services.yaml"
        "06-hpa.yaml"
        "07-vpa.yaml"
        "08-pdb.yaml"
        "09-network-policies.yaml"
        "10-ingress.yaml"
        "11-resource-limits.yaml"
        "13-log-collector-daemonset.yaml"
        "19-backup-pvc.yaml"
        "17-cron-db-backup.yaml"
        "18-cronjob-db-backup.yaml"
        "20-cronjob-token-cleanup.yaml"
        "22-cluster-autoscaler.yaml"
    )

    local failed=0
    for manifest in "${MANIFESTS[@]}"; do
        filepath="${SCRIPT_DIR}/${manifest}"
        if [ ! -f "${filepath}" ]; then
            log_warn "File not found, skipping: ${manifest}"
            continue
        fi
        if ! apply_manifest "${filepath}"; then
            failed=$((failed + 1))
        fi
    done

    echo ""
    echo "============================================"
    log_info "Applying StorageClasses..."
    echo "============================================"
    for sc_file in "${SCRIPT_DIR}"/12-storageclasses.yaml; do
        if [ -f "${sc_file}" ]; then
            apply_manifest "${sc_file}" || failed=$((failed + 1))
        fi
    done

    echo ""
    echo "============================================"
    log_info "Deployment Summary"
    echo "============================================"
    if [ "${failed}" -gt 0 ]; then
        log_warn "${failed} manifest(s) failed to apply"
    else
        log_info "All manifests applied successfully"
    fi

    echo ""
    wait_for_namespace
    verify_deployments
    verify_services
    verify_statefulsets
    verify_ingress
    verify_network_policies
    verify_cronjobs
    verify_pods_health

    echo ""
    echo "============================================"
    log_info "Deployment complete!"
    echo "============================================"
    echo ""
    echo "Useful commands:"
    echo "  kubectl get all -n ${NAMESPACE}"
    echo "  kubectl logs -f deployment/backend -n ${NAMESPACE}"
    echo "  kubectl logs -f deployment/frontend -n ${NAMESPACE}"
    echo "  kubectl top pods -n ${NAMESPACE}"
    echo "  kubectl describe ingress ahmedelbaz-ingress -n ${NAMESPACE}"
}

main "$@"
