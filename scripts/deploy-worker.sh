#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# Manual Cloudflare Worker deployment script
# ════════════════════════════════════════════════════════════════════════════
# This script deploys the Worker DIRECTLY from your machine, bypassing the
# broken Cloudflare Workers Build pipeline entirely.
#
# Requirements:
#   1. Cloudflare API Token with "Edit Cloudflare Workers" permission
#      Create one at: https://dash.cloudflare.com/profile/api-tokens
#      Use the "Edit Cloudflare Workers" template, scoped to the account.
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="your-token-here"
#   ./scripts/deploy-worker.sh
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

WORKER_NAME="ahmedelbaz"
WORKER_FILE="infra/security-audit/worker-v7-hardened.js"
ACCOUNT_ID="fd43879d968b0358dc82ab3be03fd970"

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Deploy Cloudflare Worker: ${WORKER_NAME}${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# ── Step 1: Verify environment ──────────────────────────────────────────────
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo -e "${RED}❌ CLOUDFLARE_API_TOKEN is not set${NC}"
  echo ""
  echo "Create one at: https://dash.cloudflare.com/profile/api-tokens"
  echo "Use the 'Edit Cloudflare Workers' template."
  echo ""
  echo "Then run:"
  echo "  export CLOUDFLARE_API_TOKEN='your-token-here'"
  echo "  ./scripts/deploy-worker.sh"
  exit 1
fi

# cd to repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "$WORKER_FILE" ]; then
  echo -e "${RED}❌ Worker file not found: $WORKER_FILE${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Worker file found: $WORKER_FILE${NC}"
echo -e "${GREEN}✅ Repo root: $REPO_ROOT${NC}"
echo ""

# ── Step 2: Verify token ────────────────────────────────────────────────────
echo -e "${YELLOW}→ Verifying Cloudflare API token...${NC}"
VERIFY=$(curl -sS -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json")

if echo "$VERIFY" | grep -q '"success":true'; then
  TOKEN_NAME=$(echo "$VERIFY" | grep -o '"id":"[^"]*"' | head -1)
  echo -e "${GREEN}✅ Token is valid${NC}"
else
  echo -e "${RED}❌ Token is invalid or expired${NC}"
  echo "$VERIFY"
  exit 1
fi
echo ""

# ── Step 3: Install wrangler if missing ─────────────────────────────────────
if ! command -v wrangler &> /dev/null; then
  echo -e "${YELLOW}→ Installing wrangler...${NC}"
  npm install -g wrangler@latest
fi
echo -e "${GREEN}✅ wrangler $(wrangler --version)${NC}"
echo ""

# ── Step 4: Deploy ──────────────────────────────────────────────────────────
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
export CLOUDFLARE_API_TOKEN

echo -e "${YELLOW}→ Deploying Worker '${WORKER_NAME}' to account ${ACCOUNT_ID}...${NC}"
echo ""

wrangler deploy \
  --name "$WORKER_NAME" \
  --compatibility-date 2025-09-23 \
  "$WORKER_FILE" || {
    echo -e "${RED}❌ Deploy failed. See wrangler output above.${NC}"
    exit 1
  }

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Worker deployed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Worker URL:    https://${WORKER_NAME}.ahmdelbaz28.workers.dev"
echo "Custom domain: https://ahmedelbaz.qzz.io"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Disable the broken Workers Build in Cloudflare dashboard:"
echo "     Workers & Pages → ${WORKER_NAME} → Settings → Build → Remove"
echo ""
echo "  2. (Optional) Add the CLOUDFLARE_API_TOKEN as a GitHub Secret"
echo "     to enable auto-deploy via .github/workflows/deploy-cf-worker.yml"
echo ""
