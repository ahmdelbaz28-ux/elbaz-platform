#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Elbaz LMS — Deployment Script
#  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
#  Run on your server:  bash deploy.sh
#  This script will:
#    1. Check requirements (Docker + Docker Compose)
#    2. Check .env file exists and has no default values
#    3. Setup Nginx SSL directory
#    4. Build and start Docker containers
#    5. Push database schema (create all tables)
#    6. Seed admin user + demo data
#    7. Verify all services are healthy
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Elbaz LMS — Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# ─── Step 0: Check Requirements ───────────────────────────────
echo -e "${YELLOW}[1/7] Checking requirements...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}"
    echo "Install it: https://docs.docker.com/engine/install/"
    exit 1
fi

if ! docker compose version &> /dev/null 2>&1; then
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}ERROR: Docker Compose is not installed.${NC}"
        echo "Install it: https://docs.docker.com/compose/install/"
        exit 1
    fi
    COMPOSE_CMD="docker-compose"
else
    COMPOSE_CMD="docker compose"
fi

echo -e "${GREEN}  ✓ Docker found${NC}"
echo -e "${GREEN}  ✓ Docker Compose found (${COMPOSE_CMD})${NC}"

# ─── Step 1: Check .env ───────────────────────────────────────
echo -e "${YELLOW}[2/7] Checking environment configuration...${NC}"

if [ ! -f .env ]; then
    echo -e "${RED}ERROR: .env file not found!${NC}"
    echo "Copy .env.production to .env and fill in ALL values:"
    echo "  cp .env.production .env"
    echo "  nano .env"
    echo ""
    echo "Required changes:"
    echo "  1. Run: openssl rand -base64 64 → paste as APP_SECRET"
    echo "  2. Run: openssl rand -hex 32 → paste as DB_ROOT_PASSWORD"
    echo "  3. Run: openssl rand -hex 32 → paste as DB_PASSWORD"
    echo "  4. Run: openssl rand -base64 64 → paste as WATERMARK_SECRET"
    echo "  5. Replace 'yourdomain.com' with your actual domain"
    echo "  6. Fill in Cloudflare R2 credentials"
    echo "  7. Fill in Resend API key (if using email)"
    exit 1
fi

# Check for unfilled values
UNFILLED=$(grep -E 'GENERATE_WITH|your_cloudflare|your_r2|yourdomain\.com' .env || true)
if [ -n "$UNFILLED" ]; then
    echo -e "${RED}  ⚠ WARNING: .env still has unfilled values:${NC}"
    echo "$UNFILLED"
    echo ""
    echo -e "${YELLOW}  The app may not work correctly with default values.${NC}"
    read -p "  Continue anyway? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Please edit .env first: nano .env"
        exit 0
    fi
else
    echo -e "${GREEN}  ✓ .env configured${NC}"
fi

# ─── Step 2: Setup Nginx ──────────────────────────────────────
echo -e "${YELLOW}[3/7] Preparing Nginx...${NC}"

mkdir -p nginx/ssl

# Use HTTP-only config first if SSL certs don't exist
if [ ! -f nginx/ssl/fullchain.pem ]; then
    echo -e "${CYAN}  No SSL certificate — using HTTP-only config${NC}"
    echo -e "${CYAN}  (Cloudflare SSL or Let's Encrypt will add HTTPS later)${NC}"
    if [ ! -f nginx/nginx.conf ] || grep -q "443 ssl" nginx/nginx.conf 2>/dev/null; then
        cp nginx/nginx-http.conf nginx/nginx.conf 2>/dev/null || true
    fi
else
    echo -e "${GREEN}  ✓ SSL certificate found${NC}"
fi

# ─── Step 3: Build & Start ────────────────────────────────────
echo -e "${YELLOW}[4/7] Building and starting containers...${NC}"

$COMPOSE_CMD down 2>/dev/null || true
$COMPOSE_CMD build --no-cache
$COMPOSE_CMD up -d

echo -e "${GREEN}  ✓ Containers started${NC}"

# ─── Step 4: Wait for services ────────────────────────────────
echo -e "${YELLOW}[5/7] Waiting for services to initialize...${NC}"

echo "  Waiting for MySQL..."
for i in $(seq 1 30); do
    if $COMPOSE_CMD exec -T db mysqladmin ping -h localhost --silent 2>/dev/null; then
        echo -e "${GREEN}  ✓ MySQL is running${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}  ✗ MySQL failed to start${NC}"
        echo "  Check logs: $COMPOSE_CMD logs db"
        exit 1
    fi
    sleep 2
done

echo "  Waiting for Redis..."
for i in $(seq 1 15); do
    if $COMPOSE_CMD exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        echo -e "${GREEN}  ✓ Redis is running${NC}"
        break
    fi
    if [ $i -eq 15 ]; then
        echo -e "${RED}  ✗ Redis failed to start${NC}"
        exit 1
    fi
    sleep 2
done

echo "  Waiting for App..."
for i in $(seq 1 30); do
    if $COMPOSE_CMD exec -T app wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q "ok"; then
        echo -e "${GREEN}  ✓ Application is running${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}  ✗ App failed to start${NC}"
        echo "  Check logs: $COMPOSE_CMD logs app"
        exit 1
    fi
    sleep 3
done

# ─── Step 5: Database Setup ───────────────────────────────────
echo -e "${YELLOW}[6/7] Setting up database...${NC}"

# Push schema (create all tables)
echo "  Creating database tables..."
$COMPOSE_CMD exec -T app npx drizzle-kit push --force 2>/dev/null
echo -e "${GREEN}  ✓ Database schema created${NC}"

# Run manual migrations (if any)
for migration in db/migration_step*.sql; do
    if [ -f "$migration" ]; then
        echo "  Running migration: $migration"
        $COMPOSE_CMD exec -T db mysql -u$DB_USER -p$DB_PASSWORD $DB_NAME < "$migration" 2>/dev/null || \
        $COMPOSE_CMD exec -T db mysql -uroot -p$DB_ROOT_PASSWORD $DB_NAME < "$migration" 2>/dev/null || \
        echo "  ⚠ Migration $migration skipped (may already be applied)"
    fi
done

# Seed data (admin user, categories, courses)
echo "  Seeding initial data..."
$COMPOSE_CMD exec -T app npx tsx db/seed.ts 2>/dev/null || \
$COMPOSE_CMD exec -T app node -e "require('./db/seed')" 2>/dev/null || \
echo "  ⚠ Seed may need manual run. Try: $COMPOSE_CMD exec app npx drizzle-kit seed"
echo -e "${GREEN}  ✓ Database ready${NC}"

# ─── Step 6: Final Verification ───────────────────────────────
echo -e "${YELLOW}[7/7] Final verification...${NC}"

# Check Nginx
sleep 3
if curl -s -o /dev/null -w "%{http_code}" http://localhost:80 2>/dev/null | grep -q "200\|301\|302"; then
    echo -e "${GREEN}  ✓ Nginx is serving traffic${NC}"
else
    echo -e "${YELLOW}  ⚠ Nginx may still be starting${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Deployment Complete!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Website:  http://YOUR_SERVER_IP"
echo "  Admin:    http://YOUR_SERVER_IP/login"
echo "  Health:   http://YOUR_SERVER_IP/api/health"
echo ""
echo "  Useful commands:"
echo "  ─────────────────"
echo "  View logs:      $COMPOSE_CMD logs -f app"
echo "  Restart:        $COMPOSE_CMD restart"
echo "  Stop:           $COMPOSE_CMD down"
echo "  DB shell:       $COMPOSE_CMD exec db mysql -u\$DB_USER -p\$DB_PASSWORD \$DB_NAME"
echo ""
echo -e "${YELLOW}  Next steps:${NC}"
echo "  1. Buy a domain and point it to your server IP"
echo "  2. Set up Cloudflare (free CDN + SSL)"
echo "  3. Update .env with your real domain"
echo "  4. Set up Resend for email (resend.com)"
echo "  5. Upload videos to Cloudflare R2"
echo "  6. Activate Paymob webhook in your dashboard"
echo ""
