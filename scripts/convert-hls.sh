#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Elbaz LMS — Convert MP4 videos to HLS format
# ═══════════════════════════════════════════════════════════════════
# Usage: ./scripts/convert-hls.sh input.mp4 [output_name]
#
# Requirements: ffmpeg (sudo apt install ffmpeg)
#
# Output: Creates .m3u8 + .ts segment files
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

INPUT="${1:-}"
NAME="${2:-$(basename "$INPUT" .mp4)}"
SEGMENT_DURATION="${HLS_SEGMENT_DURATION:-10}"
QUALITY="${HLS_QUALITY:-multi}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <input.mp4> [output_name]"
    echo ""
    echo "Environment Variables:"
    echo "  HLS_SEGMENT_DURATION  Segment length in seconds (default: 10)"
    echo "  HLS_QUALITY           multi | 720p | 480p | 360p (default: multi)"
    echo ""
    echo "Examples:"
    echo "  $0 lesson1.mp4"
    echo "  HLS_QUALITY=720p $0 lesson1.mp4 etap-lesson1"
    exit 1
}

if [ -z "$INPUT" ]; then
    echo -e "${RED}Error: No input file specified${NC}"
    usage
fi

if [ ! -f "$INPUT" ]; then
    echo -e "${RED}Error: File not found: $INPUT${NC}"
    exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
    echo -e "${RED}Error: ffmpeg is not installed${NC}"
    echo "Install with: sudo apt install ffmpeg"
    exit 1
fi

OUTPUT_DIR="./hls_output/${NAME}"
mkdir -p "$OUTPUT_DIR"

echo -e "${GREEN}Converting: $INPUT → $OUTPUT_DIR${NC}"
echo -e "Quality: ${YELLOW}$QUALITY${NC} | Segment: ${SEGMENT_DURATION}s"

case "$QUALITY" in
    "multi")
        echo -e "${GREEN}Creating multi-quality HLS (360p, 480p, 720p, 1080p)...${NC}"
        ffmpeg -i "$INPUT" \
            -filter_complex "[0:v]split=4[v1][v2][v3][v4]; \
                [v1]scale=-2:360[v1out]; \
                [v2]scale=-2:480[v2out]; \
                [v3]scale=-2:720[v3out]; \
                [v4]scale=-2:1080[v4out]" \
            -map "[v1out]" -c:v libx264 -b:v:0 800k -maxrate:0 1000k \
            -map "[v2out]" -c:v libx264 -b:v:1 1400k -maxrate:1 2000k \
            -map "[v3out]" -c:v libx264 -b:v:2 2800k -maxrate:2 4000k \
            -map "[v4out]" -c:v libx264 -b:v:3 5000k -maxrate:3 7000k \
            -map a:0 -c:a aac -b:a 128k -ac 2 \
            -f hls \
            -hls_time "$SEGMENT_DURATION" \
            -hls_playlist_type vod \
            -hls_segment_filename "$OUTPUT_DIR/segment_%v_%03d.ts" \
            -master_pl_name "master.m3u8" \
            -var_stream_map "v:0,a:0 v:1,a:0 v:2,a:0 v:3,a:0" \
            -hls_list_size 0 \
            "$OUTPUT_DIR/stream_%v.m3u8" \
            -y 2>&1 | tail -5
        ;;
    "720p")
        ffmpeg -i "$INPUT" \
            -c:v libx264 -preset medium -b:v 2800k -maxrate 4000k -bufsize 5600k \
            -vf "scale=-2:720" \
            -c:a aac -b:a 128k -ac 2 \
            -f hls \
            -hls_time "$SEGMENT_DURATION" \
            -hls_playlist_type vod \
            -hls_segment_filename "$OUTPUT_DIR/segment_%03d.ts" \
            -hls_list_size 0 \
            "$OUTPUT_DIR/index.m3u8" \
            -y 2>&1 | tail -5
        ;;
    "480p")
        ffmpeg -i "$INPUT" \
            -c:v libx264 -preset medium -b:v 1400k -maxrate 2000k -bufsize 2800k \
            -vf "scale=-2:480" \
            -c:a aac -b:a 128k -ac 2 \
            -f hls \
            -hls_time "$SEGMENT_DURATION" \
            -hls_playlist_type vod \
            -hls_segment_filename "$OUTPUT_DIR/segment_%03d.ts" \
            -hls_list_size 0 \
            "$OUTPUT_DIR/index.m3u8" \
            -y 2>&1 | tail -5
        ;;
    "360p")
        ffmpeg -i "$INPUT" \
            -c:v libx264 -preset fast -b:v 800k -maxrate 1000k -bufsize 1600k \
            -vf "scale=-2:360" \
            -c:a aac -b:a 96k -ac 2 \
            -f hls \
            -hls_time "$SEGMENT_DURATION" \
            -hls_playlist_type vod \
            -hls_segment_filename "$OUTPUT_DIR/segment_%03d.ts" \
            -hls_list_size 0 \
            "$OUTPUT_DIR/index.m3u8" \
            -y 2>&1 | tail -5
        ;;
    *)
        echo -e "${RED}Unknown quality: $QUALITY${NC}"
        usage
        ;;
esac

SEGMENT_COUNT=$(find "$OUTPUT_DIR" -name "*.ts" | wc -l)
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
M3U8_FILE=$(find "$OUTPUT_DIR" -name "*.m3u8" | head -1)

echo ""
echo -e "${GREEN}Conversion complete!${NC}"
echo "  Output: $OUTPUT_DIR"
echo "  Playlist: $M3U8_FILE"
echo "  Segments: $SEGMENT_COUNT"
echo "  Total size: $TOTAL_SIZE"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Upload the entire folder to R2: videos/$NAME/"
echo "  2. Set lesson.videoUrl to: r2://videos/$NAME/master.m3u8"
echo "  3. The app auto-detects .m3u8 and uses HLS.js for adaptive streaming"
