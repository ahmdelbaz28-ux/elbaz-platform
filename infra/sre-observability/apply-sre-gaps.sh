#!/bin/bash
set -euo pipefail
NAMESPACE="ahmedelbaz"
ORDER=(
  "infra/sre-observability/loki/00-loki.yaml"
  "infra/sre-observability/promtail/00-promtail.yaml"
  "infra/sre-observability/promtail/01-promtail-daemonset.yaml"
  "infra/sre-observability/node-exporter/00-node-exporter.yaml"
  "infra/sre-observability/thanos-querier/00-thanos-querier-store-compact.yaml"
  "infra/sre-observability/prometheus/05-sre-comprehensive-rules.yaml"
  "infra/sre-observability/auto-recovery/01-health-probe-cronjob.yaml"
  "infra/sre-observability/grafana-dashboards/06-loki-log-analytics.json"
  "infra/sre-observability/grafana-dashboards/07-node-monitoring.json"
)
echo "========================================="
echo "  Elbaz Platform SRE Gap Deployment"
echo "  $(date -u)"
echo "========================================="
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"
kubectl apply -f infra/sre-observability/cert-manager/00-cluster-issuer.yaml 2>/dev/null || echo "[SKIP] cert-manager issuer (requires cert-manager installed)"
for MANIFEST in "${ORDER[@]}"; do
  if [ -f "$MANIFEST" ]; then
    echo "[APPLY] $MANIFEST"
    kubectl apply -f "$MANIFEST" --namespace="$NAMESPACE"
  else
    echo "[MISSING] $MANIFEST"
  fi
done
echo ""
echo "========================================="
echo "  Verifying Deployments"
echo "========================================="
DEPLOYMENTS=("loki" "thanos-querier" "thanos-store" "thanos-compact")
DAEMONSETS=("promtail" "node-exporter")
CRONJOBS=("elbaz-platform-health-probe" "elbaz-platform-auto-heal")
for DEPLOY in "${DEPLOYMENTS[@]}"; do
  READY=$(kubectl get deploy "$DEPLOY" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  DESIRED=$(kubectl get deploy "$DEPLOY" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  echo "  Deployment $DEPLOY: $READY/$DESIRED ready"
done
for DS in "${DAEMONSETS[@]}"; do
  READY=$(kubectl get daemonset "$DS" -n "$NAMESPACE" -o jsonpath='{.status.numberReady}' 2>/dev/null || echo "0")
  DESIRED=$(kubectl get daemonset "$DS" -n "$NAMESPACE" -o jsonpath='{.status.desiredNumberScheduled}' 2>/dev/null || echo "0")
  echo "  DaemonSet $DS: $READY/$DESIRED ready"
done
for CJ in "${CRONJOBS[@]}"; do
  echo "  CronJob $CJ: $(kubectl get cronjob "$CJ" -n "$NAMESPACE" -o jsonpath='{.status.lastScheduleTime}' 2>/dev/null || echo 'not scheduled')"
done
echo ""
echo "========================================="
echo "  Service Endpoints"
echo "========================================="
SERVICES=("loki:3100" "promtail:3101" "node-exporter:9100" "thanos-querier:19192" "thanos-store:10901" "thanos-compact:10902")
for SVC in "${SERVICES[@]}"; do
  NAME="${SVC%%:*}"
  PORT="${SVC##*:}"
  echo "  $NAME:$PORT"
done
echo ""
echo "========================================="
echo "  Deployment Complete"
echo "========================================="
