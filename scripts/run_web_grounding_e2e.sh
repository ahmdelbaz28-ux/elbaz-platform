#!/usr/bin/env bash
# WEB GROUNDING E2E runner (Task 13) — mock upstream + platform server + assertions
set -u
cd "$(dirname "$0")/.."

MYSQL_URL="mysql://user:pass@127.0.0.1:3306/testdb"

echo "== cleanup leftovers =="
pkill -f "tsx api/boot.ts" 2>/dev/null
pkill -f "mock_openrouter.mjs" 2>/dev/null
sleep 1

echo "== start mock upstream =="
setsid nohup node scripts/mock_openrouter.mjs >/tmp/mock_openrouter.log 2>&1 &
disown
sleep 1

echo "== start platform server (:3999) — boots db-init first =="
setsid nohup env NODE_OPTIONS=--max-old-space-size=3072 \
  PORT=3999 \
  DATABASE_URL="mysql://user:pass@127.0.0.1:3306/testdb" \
  APP_SECRET="test-secret-e2e-0123456789abcdef-0123" \
  SESSION_SECRET="test-session-secret-e2e-0123456789abcdef" \
  JWT_SECRET="test-jwt-secret-e2e-0123456789abcdef" \
  OPENROUTER_API_KEY="sk-or-test" \
  GOOGLE_CLIENT_ID="test.apps.googleusercontent.com" \
  npx tsx api/boot.ts >/tmp/boot_web_grounding.log 2>&1 &
disown

echo "== wait for server health (db-init creates the 24 tables) =="
for i in $(seq 1 40); do
  sleep 2
  if curl -sf http://127.0.0.1:3999/api/health >/dev/null 2>&1; then echo "server UP (attempt $i)"; break; fi
done

echo "== seed mock provider rows (after db-init) =="
DATABASE_URL="$MYSQL_URL" node scripts/seed_mock_provider.mjs seed
echo "== run e2e assertions (phase: main = T1-T3) =="
python3 scripts/web_grounding_e2e.py main
E2E_EXIT=$?

if [ $E2E_EXIT -eq 0 ]; then
  echo "== enable mock/charged (tier1) =="
  DATABASE_URL="$MYSQL_URL" node scripts/seed_mock_provider.mjs enable-charged

  echo "== restart server (clears the in-memory last-working pin) =="
  pkill -f "tsx api/boot.ts" 2>/dev/null
  sleep 2
  setsid nohup env NODE_OPTIONS=--max-old-space-size=3072 \
    PORT=3999 \
    DATABASE_URL="mysql://user:pass@127.0.0.1:3306/testdb" \
    APP_SECRET="test-secret-e2e-0123456789abcdef-0123" \
    SESSION_SECRET="test-session-secret-e2e-0123456789abcdef" \
    JWT_SECRET="test-jwt-secret-e2e-0123456789abcdef" \
    OPENROUTER_API_KEY="sk-or-test" \
    GOOGLE_CLIENT_ID="test.apps.googleusercontent.com" \
    npx tsx api/boot.ts >/tmp/boot_web_grounding.log 2>&1 &
  disown
  for i in $(seq 1 30); do
    sleep 2
    if curl -sf http://127.0.0.1:3999/api/health >/dev/null 2>&1; then echo "server UP (attempt $i)"; break; fi
  done

  echo "== run e2e assertions (phase: t4 = 402 breaker) =="
  python3 scripts/web_grounding_e2e.py t4
  E2E_EXIT=$?
fi

echo "== reset mock provider rows (leave DB clean) =="
DATABASE_URL="$MYSQL_URL" node scripts/seed_mock_provider.mjs clean

echo "== stop processes =="
pkill -f "tsx api/boot.ts" 2>/dev/null
pkill -f "mock_openrouter.mjs" 2>/dev/null

echo "== e2e exit: $E2E_EXIT =="
exit $E2E_EXIT
