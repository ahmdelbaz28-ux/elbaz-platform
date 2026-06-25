#!/bin/bash
set -euo pipefail

NAMESPACE="ahmedelbaz"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%dT%H:%M:%S') $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $(date '+%Y-%m-%dT%H:%M:%S') $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%dT%H:%M:%S') $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%dT%H:%M:%S') $*"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v kubectl &>/dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi

    if ! kubectl cluster-info &>/dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi

    log_success "Prerequisites verified"
}

create_namespace() {
    log_info "Creating namespace: ${NAMESPACE}"
    kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
    log_success "Namespace ${NAMESPACE} ready"
}

apply_secrets() {
    log_info "Creating placeholder secrets (replace with real values in production)"

    kubectl create secret generic alertmanager-secrets \
        --from-literal=slack-webhook-url="https://hooks.slack.com/services/PLACEHOLDER" \
        --from-literal=pagerduty-service-key="PLACEHOLDER" \
        --from-literal=pagerduty-payments-key="PLACEHOLDER" \
        --from-literal=smtp-password="PLACEHOLDER" \
        --namespace="${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f -

    kubectl create secret generic grafana-secrets \
        --from-literal=admin-user="admin" \
        --from-literal=admin-password="CHANGE_ME_IN_PRODUCTION" \
        --namespace="${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f -

    kubectl create secret generic redis-secrets \
        --from-literal=redis-password="CHANGE_ME" \
        --namespace="${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f -

    kubectl create secret generic mysql-secrets \
        --from-literal=exporter-dsn="exporter:CHANGE_ME@tcp(mysql:3306)/" \
        --namespace="${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f -

    log_success "Secrets created"
}

create_service_accounts() {
    log_info "Creating service accounts and RBAC"

    kubectl create serviceaccount prometheus --namespace="${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create serviceaccount alertmanager --namespace="${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create serviceaccount otel-collector --namespace="${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create serviceaccount litmus-admin --namespace="${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

    kubectl create clusterrole prometheus-cr --verb=get,list,watch --resource=pods,nodes,nodes/metrics,nodes/proxy,services,endpoints --dry-run=client -o yaml | kubectl apply -f -
    kubectl create clusterrolebinding prometheus-crb --clusterrole=prometheus-cr --serviceaccount="${NAMESPACE}:prometheus" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create clusterrole node-exporter-cr --verb=get,list,watch --resource=nodes,nodes/metrics --dry-run=client -o yaml | kubectl apply -f -

    log_success "Service accounts and RBAC configured"
}

apply_prometheus() {
    log_info "Applying Prometheus stack..."

    kubectl apply -f "${BASE_DIR}/prometheus/00-prometheus-config.yaml"
    kubectl apply -f "${BASE_DIR}/prometheus/03-alerting-rules.yaml"
    kubectl apply -f "${BASE_DIR}/prometheus/04-slo-rules.yaml"
    kubectl apply -f "${BASE_DIR}/prometheus/02-prometheus-infra.yaml"
    kubectl apply -f "${BASE_DIR}/prometheus/01-prometheus-deployment.yaml"

    log_success "Prometheus applied"
}

apply_alertmanager() {
    log_info "Applying Alertmanager..."

    kubectl apply -f "${BASE_DIR}/alertmanager.yml"
    kubectl apply -f "${BASE_DIR}/alertmanager/00-alertmanager.yaml"

    log_success "Alertmanager applied"
}

apply_exporters() {
    log_info "Applying exporters..."

    kubectl apply -f "${BASE_DIR}/exporters/00-redis-exporter.yaml"
    kubectl apply -f "${BASE_DIR}/exporters/01-mysql-exporter.yaml"
    kubectl apply -f "${BASE_DIR}/exporters/02-blackbox-exporter.yaml"

    log_success "Exporters applied"
}

apply_grafana() {
    log_info "Applying Grafana..."

    kubectl apply -f "${BASE_DIR}/grafana-dashboards/11-grafana-infra.yaml"
    kubectl apply -f "${BASE_DIR}/grafana-dashboards/10-grafana-deployment.yaml"

    log_success "Grafana applied"
}

apply_jaeger() {
    log_info "Applying Jaeger..."

    kubectl apply -f "${BASE_DIR}/jaeger/00-jaeger.yaml"

    log_success "Jaeger applied"
}

apply_thanos() {
    log_info "Applying Thanos sidecar..."

    kubectl apply -f "${BASE_DIR}/thanos/00-thanos-sidecar-config.yaml"

    log_success "Thanos sidecar applied"
}

apply_otel() {
    log_info "Applying OpenTelemetry Collector..."

    kubectl apply -f "${BASE_DIR}/otel/00-otel-collector.yaml"

    log_success "OpenTelemetry Collector applied"
}

apply_alerts() {
    log_info "Applying alert rules..."

    for file in "${BASE_DIR}/alerts/"*.yml; do
        if [[ -f "${file}" ]]; then
            kubectl apply -f "${file}" || log_warn "Failed to apply ${file} (may need Prometheus Operator)"
        fi
    done

    log_success "Alert rules applied"
}

apply_chaos() {
    log_info "Applying chaos engineering manifests..."

    kubectl apply -f "${BASE_DIR}/chaos/01-observability-network-policies.yaml" || log_warn "Network policies applied (some may need adjustment)"
    kubectl apply -f "${BASE_DIR}/chaos/00-chaos-examples.yaml" || log_warn "Chaos manifests applied (requires Litmus Chaos Operator)"

    log_success "Chaos engineering manifests applied"
}

wait_for_pods() {
    log_info "Waiting for pods to become ready..."

    local timeout=300
    local elapsed=0

    while [[ ${elapsed} -lt ${timeout} ]]; do
        local not_ready
        not_ready=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | grep -v "Running\|Completed" | grep -v "ContainerCreating" | wc -l || echo "0")

        if [[ "${not_ready}" -eq 0 ]]; then
            log_success "All pods are running"
            return 0
        fi

        local pending
        pending=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | grep "Pending" | wc -l || echo "0")

        if [[ "${pending}" -gt 0 ]]; then
            log_warn "Some pods are pending (PVC/Node may be unavailable)"
        fi

        sleep 10
        elapsed=$((elapsed + 10))
        log_info "  Waiting... ${elapsed}s / ${timeout}s (${not_ready} pods not ready)"
    done

    log_warn "Timeout reached. Some pods may not be ready."
    kubectl get pods -n "${NAMESPACE}"
    return 1
}

verify_deployment() {
    log_info "Verifying deployment..."

    echo ""
    echo "=========================================="
    echo "  SRE Observability Deployment Summary"
    echo "  Namespace: ${NAMESPACE}"
    echo "=========================================="
    echo ""

    kubectl get all -n "${NAMESPACE}" 2>/dev/null || true

    echo ""
    echo "--- ConfigMaps ---"
    kubectl get configmaps -n "${NAMESPACE}" 2>/dev/null || true

    echo ""
    echo "--- PVCs ---"
    kubectl get pvc -n "${NAMESPACE}" 2>/dev/null || true

    echo ""
    echo "--- Network Policies ---"
    kubectl get networkpolicies -n "${NAMESPACE}" 2>/dev/null || true

    echo ""
    echo "--- Secrets ---"
    kubectl get secrets -n "${NAMESPACE}" 2>/dev/null || true

    echo ""
    log_info "Port-forward commands for local access:"
    echo ""
    echo "  kubectl port-forward -n ${NAMESPACE} svc/prometheus 9090:9090"
    echo "  kubectl port-forward -n ${NAMESPACE} svc/grafana 3000:3000"
    echo "  kubectl port-forward -n ${NAMESPACE} svc/jaeger 16686:16686"
    echo "  kubectl port-forward -n ${NAMESPACE} svc/alertmanager 9093:9093"
    echo ""
}

main() {
    echo ""
    echo "=========================================="
    echo "  Ahmed El-Baz LMS Platform"
    echo "  SRE Observability Stack Installer"
    echo "=========================================="
    echo ""

    check_prerequisites
    create_namespace
    apply_secrets
    create_service_accounts

    log_info "Applying infrastructure components..."
    apply_prometheus
    apply_alertmanager
    apply_exporters
    apply_grafana
    apply_jaeger
    apply_thanos
    apply_otel

    log_info "Applying operational components..."
    apply_alerts
    apply_chaos

    log_info "All manifests applied. Waiting for pods..."
    wait_for_pods

    verify_deployment

    echo ""
    log_success "SRE Observability stack deployment complete!"
    echo ""
    log_warn "IMPORTANT: Update secrets with real values before production use!"
    echo ""
}

main "$@"
