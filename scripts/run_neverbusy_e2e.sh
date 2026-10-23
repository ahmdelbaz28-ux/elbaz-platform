#!/usr/bin/env bash
# NEVER-BUSY e2e runner — mock upstream + platform server + 3 phases.
# Each phase restarts the server so the in-memory breaker state is fresh.
set -u
cd "$(dirname "$0")/.."

MYSQL_URL="mysql://user:pass@127.0.0.1:3306/testdb"
PERSIST_MS=8000
EXIT=0

kill_servers () {
  pkill -f "tsx api/boot.ts" 2>/dev/null
  sleep 2
}

start_server () {
  setsid nohup env NODE_OPTIONS=--max-old-space-size=3072 \
    PORT=3999 \
    DATABASE_URL="$MYSQL_URL" \
    APP_SECRET="test-secret-e2e-0123456789abcdef-0123" \
    SESSION_SECRET="test-session-secret-e2e-0123456789abcdef" \
    JWT_SECRET="test-jwt-secret-e2e-0123456789abcdef" \
    OPENROUTER_API_KEY="sk-or-test" \
    CHATBOT_STREAM_PERSIST_MS="$PERSIST_MS" \
    CHATBOT_NONSTREAM_PERSIST_MS=4000 \
    GOOGLE_CLIENT_ID="test.apps.googleusercontent.com" \
    npx tsx api/boot.ts >/tmp/boot_neverbusy.log 2>&1 &
  disown
}

wait_up () {
  for i in $(seq 1 40); do
    sleep 2
    if curl -sf http://127.0.0.1:3999/api/health >/dev/null 2>&1; then echo "server UP (attempt $i)"; return 0; fi
  done
  echo "server failed to start — check /tmp/boot_neverbusy.log"; return 1
}

seed () {
  DATABASE_URL="$MYSQL_URL" node scripts/seed_mock_provider.mjs "$1"
}

echo "== cleanup leftovers =="
pkill -f mock_openrouter.mjs 2>/dev/null
kill_servers

echo "== start mock upstream (:47777) =="
setsid nohup node scripts/mock_openrouter.mjs >/tmp/mock_openrouter.log 2>&1 &
disown
sleep 1

echo "== boot server once (db-init creates the tables) =="
start_server
wait_up || exit 1

echo "== ── PHASE T1: daily-429 storm → persistence + soft busy ──"
seed seed-429
python3 scripts/neverbusy_e2e.py t1 "$PERSIST_MS" || EXIT=1

echo "== ── PHASE T2: slow winner → SSE-first + keepalive before content ──"
kill_servers
start_server
wait_up || exit 1
seed seed-slow
python3 scripts/neverbusy_e2e.py t2 "$PERSIST_MS" || EXIT=1

echo "== ── PHASE T3: breaker hand-off to Groq ──"
kill_servers
start_server
wait_up || exit 1
seed seed-429-groq
python3 scripts/neverbusy_e2e.py t3 "$PERSIST_MS" || EXIT=1

echo "== ── PHASE T4: dud winner (zero content) → silent re-walk serves the user ──"
kill_servers
start_server
wait_up || exit 1
seed seed-dud
python3 scripts/neverbusy_e2e.py t4 "$PERSIST_MS" || EXIT=1

echo "== ── PHASE T5: vision policy — image answered by the text cascade, never a VL model ──"
kill_servers
start_server
wait_up || exit 1
seed seed-vision
python3 scripts/neverbusy_e2e.py t5 "$PERSIST_MS" || EXIT=1

echo "== ── PHASE T6: kilo lane (FIRST provider) exhausts model-by-model → groq ──"
kill_servers
start_server
wait_up || exit 1
seed seed-kilo-lane
python3 scripts/neverbusy_e2e.py t6 "$PERSIST_MS" || EXIT=1

echo "== cleanup =="
kill_servers
pkill -f mock_openrouter.mjs 2>/dev/null

if [ "$EXIT" -ne 0 ]; then echo "NEVER-BUSY E2E: FAILED"; exit 1; fi
echo "NEVER-BUSY E2E: ALL PHASES PASSED"
