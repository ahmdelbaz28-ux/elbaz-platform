#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Elbaz LMS — Upload HLS/MP4 videos to Cloudflare R2
# ═══════════════════════════════════════════════════════════════════
# Usage: ./scripts/upload-to-r2.sh <local_folder> <r2_prefix>
#
# Requirements: AWS CLI v2 (pip install awscli)
#
# Environment Variables (or set in .env):
#   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

LOCAL_DIR="${1:-}"
R2_PREFIX="${2:-videos}"
ACCOUNT_ID="${R2_ACCOUNT_ID:?Error: R2_ACCOUNT_ID must be set}"
BUCKET="${R2_BUCKET:-elbaz-videos}"
ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <local_folder> [r2_prefix]"
    echo ""
    echo "Examples:"
    echo "  $0 ./hls_output/etap-lesson1"
    echo "  $0 ./hls_output/etap-lesson1 videos/etap"
    echo ""
    echo "Environment Variables:"
    echo "  R2_ACCOUNT_ID       Cloudflare Account ID"
    echo "  R2_BUCKET           R2 Bucket name (default: elbaz-videos)"
    echo "  AWS_ACCESS_KEY_ID   R2 Access Key ID"
    echo "  AWS_SECRET_ACCESS_KEY  R2 Secret Access Key"
    exit 1
}

if [ -z "$LOCAL_DIR" ]; then
    echo -e "${RED}Error: No local folder specified${NC}"
    usage
fi

if [ ! -d "$LOCAL_DIR" ]; then
    echo -e "${RED}Error: Directory not found: $LOCAL_DIR${NC}"
    exit 1
fi

if ! command -v aws &>/dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Install with: pip install awscli"
    echo "  or:  curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip"
    exit 1
fi

# Verify credentials are set
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
    echo -e "${YELLOW}Warning: AWS_ACCESS_KEY_ID not set. Using R2_ACCESS_KEY_ID...${NC}"
    export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
fi

if [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    echo -e "${YELLOW}Warning: AWS_SECRET_ACCESS_KEY not set. Using R2_SECRET_ACCESS_KEY...${NC}"
    export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
fi

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo -e "${RED}Error: R2 credentials not configured${NC}"
    echo "Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your environment"
    exit 1
fi

# Sync files to R2
echo -e "${GREEN}Uploading to R2...${NC}"
echo "  Source: $LOCAL_DIR/"
echo "  Target: s3://${BUCKET}/${R2_PREFIX}/"
echo "  Endpoint: $ENDPOINT"
echo ""

aws s3 sync "$LOCAL_DIR/" "s3://${BUCKET}/${R2_PREFIX}/" \
    --endpoint-url "$ENDPOINT" \
    --content-type "video/mp2t" \
    --exclude "*" --include "*.ts" \
    --no-progress

aws s3 sync "$LOCAL_DIR/" "s3://${BUCKET}/${R2_PREFIX}/" \
    --endpoint-url "$ENDPOINT" \
    --content-type "application/vnd.apple.mpegurl" \
    --exclude "*" --include "*.m3u8" \
    --no-progress

aws s3 sync "$LOCAL_DIR/" "s3://${BUCKET}/${R2_PREFIX}/" \
    --endpoint-url "$ENDPOINT" \
    --content-type "video/mp4" \
    --exclude "*" --include "*.mp4" \
    --no-progress

# Count uploaded files
FILE_COUNT=$(aws s3 ls "s3://${BUCKET}/${R2_PREFIX}/" \
    --endpoint-url "$ENDPOINT" --recursive | wc -l)

echo ""
echo -e "${GREEN}Upload complete!${NC}"
echo "  Files uploaded: $FILE_COUNT"
echo "  R2 path: ${R2_PREFIX}/"
echo ""
echo -e "${YELLOW}To use in the platform:${NC}"
echo "  Update lesson.videoUrl in the database:"
echo "  UPDATE lessons SET videoUrl = 'r2://${R2_PREFIX}/master.m3u8' WHERE id = LESSON_ID;"
echo ""
echo "  Or use the Admin Dashboard to set the video URL for each lesson."
