#!/bin/bash
set -euo pipefail

NAMESPACE="ahmedelbaz"
HEALTH_ENDPOINT="http://localhost:3001/api/health"
MYSQL_HOST="mysql"
REDIS_HOST="redis-master"
DISK_THRESHOLD=85
MEMORY_THRESHOLD=90
CPU_THRESHOLD=90
SSL_DOMAIN="lms.ahmedelbaz.dev"
LOG_FILE="/var/log/health-checks/health-check-$(date +%Y%m%d-%H%M%S).log"

mkdir -p /var/log/health-checks

log() {
    local level="$1"
    shift
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [${level}] $*" | tee -a "${LOG_FILE}"
}

check_api_health() {
    log "INFO" "Checking API health endpoint: ${HEALTH_ENDPOINT}"
    local response
    local http_code
    http_code=$(curl -sf -o /tmp/health-response.json -w '%{http_code}' --connect-timeout 5 --max-time 10 "${HEALTH_ENDPOINT}" 2>/dev/null || true)

    if [[ "${http_code}" == "200" ]]; then
        response=$(cat /tmp/health-response.json 2>/dev/null || echo '{}')
        log "INFO" "API health check passed (HTTP ${http_code}): ${response}"
        return 0
    else
        log "ERROR" "API health check failed (HTTP ${http_code})"
        return 1
    fi
}

check_database() {
    log "INFO" "Checking MySQL connection: ${MYSQL_HOST}:3306"
    local result
    result=$(mysqladmin ping -h "${MYSQL_HOST}" -u exporter -p"${MYSQL_EXPORTER_PASSWORD}" 2>/dev/null || echo "FAILED")

    if [[ "${result}" == *"alive"* ]]; then
        log "INFO" "MySQL connection: OK"
        return 0
    else
        log "ERROR" "MySQL connection: FAILED"
        return 1
    fi
}

check_redis() {
    log "INFO" "Checking Redis connection: ${REDIS_HOST}:6379"
    local result
    result=$(redis-cli -h "${REDIS_HOST}" -a "${REDIS_PASSWORD}" ping 2>/dev/null || echo "FAILED")

    if [[ "${result}" == "PONG" ]]; then
        log "INFO" "Redis connection: OK"
        return 0
    else
        log "ERROR" "Redis connection: FAILED"
        return 1
    fi
}

check_disk_space() {
    log "INFO" "Checking disk space (threshold: ${DISK_THRESHOLD}%)"
    local usage
    usage=$(df / | awk 'NR==2{print $5}' | tr -d '%')

    if [[ "${usage}" -lt "${DISK_THRESHOLD}" ]]; then
        log "INFO" "Disk space: ${usage}% (OK)"
        return 0
    else
        log "ERROR" "Disk space: ${usage}% (EXCEEDED ${DISK_THRESHOLD}%)"
        return 1
    fi
}

check_memory() {
    log "INFO" "Checking memory usage (threshold: ${MEMORY_THRESHOLD}%)"
    local usage
    usage=$(free | awk '/Mem/{printf "%.0f", $3/$2 * 100}')

    if [[ "${usage}" -lt "${MEMORY_THRESHOLD}" ]]; then
        log "INFO" "Memory usage: ${usage}% (OK)"
        return 0
    else
        log "ERROR" "Memory usage: ${usage}% (EXCEEDED ${MEMORY_THRESHOLD}%)"
        return 1
    fi
}

check_cpu() {
    log "INFO" "Checking CPU usage (threshold: ${CPU_THRESHOLD}%)"
    local usage
    usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'.' -f1)

    if [[ "${usage}" -lt "${CPU_THRESHOLD}" ]]; then
        log "INFO" "CPU usage: ${usage}% (OK)"
        return 0
    else
        log "ERROR" "CPU usage: ${usage}% (EXCEEDED ${CPU_THRESHOLD}%)"
        return 1
    fi
}

check_ssl() {
    log "INFO" "Checking SSL certificate for: ${SSL_DOMAIN}"
    local expiry
    local expiry_days
    expiry=$(echo | openssl s_client -servername "${SSL_DOMAIN}" -connect "${SSL_DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || echo "")
    
    if [[ -n "${expiry}" ]]; then
        expiry_date=$(echo "${expiry}" | cut -d= -f2)
        expiry_epoch=$(date -d "${expiry_date}" +%s 2>/dev/null || echo 0)
        current_epoch=$(date +%s)
        expiry_days=$(( (expiry_epoch - current_epoch) / 86400 ))

        if [[ "${expiry_days}" -gt 7 ]]; then
            log "INFO" "SSL certificate expires in ${expiry_days} days (OK)"
            return 0
        else
            log "ERROR" "SSL certificate expires in ${expiry_days} days (LESS THAN 7 DAYS)"
            return 1
        fi
    else
        log "ERROR" "Could not retrieve SSL certificate for ${SSL_DOMAIN}"
        return 1
    fi
}

check_pod_status() {
    log "INFO" "Checking pod status in namespace: ${NAMESPACE}"
    local not_ready
    not_ready=$(kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | grep -v "Running\|Completed" | wc -l || echo "0")

    if [[ "${not_ready}" -eq 0 ]]; then
        log "INFO" "All pods running (OK)"
        return 0
    else
        log "ERROR" "${not_ready} pods not running"
        kubectl get pods -n "${NAMESPACE}" --no-headers 2>/dev/null | grep -v "Running\|Completed" | while read -r line; do
            log "ERROR" "  ${line}"
        done
        return 1
    fi
}

main() {
    log "INFO" "=== Health Check Started ==="
    local failed=0
    local passed=0
    local total=0

    for check in check_api_health check_database check_redis check_disk_space check_memory check_cpu check_ssl check_pod_status; do
        total=$((total + 1))
        if ${check}; then
            passed=$((passed + 1))
        else
            failed=$((failed + 1))
        fi
    done

    log "INFO" "=== Health Check Complete: ${passed}/${total} passed, ${failed} failed ==="

    if [[ "${failed}" -gt 0 ]]; then
        exit 1
    fi
    exit 0
}

main "$@"
