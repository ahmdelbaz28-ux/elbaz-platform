#!/usr/bin/env bash
# KILO LIVE LOCAL e2e — embedded MySQL + server with the REAL kilocode
# gateway as FIRST provider (real token via env) + mock groq safety net.
set -u
cd /home/z/my-project/work/elbaz-platform

KILO_TOKEN="${KILO_TOKEN:?set KILO_TOKEN}"
MYSQL_URL="mysql://user:pass@127.0.0.1:3306/testdb"

echo "== cleanup =="
pkill -f mock_openrouter.mjs 2>/dev/null
pkill -f "tsx api/boot.ts" 2>/dev/null
sleep 2

echo "== start mock upstream (:47777) =="
setsid nohup node scripts/mock_openrouter.mjs >/tmp/mock_openrouter.log 2>&1 &
disown
sleep 1

echo "== boot server (REAL kilocode first + mock groq net) =="
setsid nohup env NODE_OPTIONS=--max-old-space-size=3072 \
  PORT=3999 \
  DATABASE_URL="$MYSQL_URL" \
  APP_SECRET="test-secret-e2e-0123456789abcdef-0123" \
  SESSION_SECRET="test-session-secret-e2e-0123456789abcdef" \
  JWT_SECRET="test-jwt-secret-e2e-0123456789abcdef" \
  KILOCODE_API_KEY="$KILO_TOKEN" \
  GOOGLE_CLIENT_ID="test.apps.googleusercontent.com" \
  npx tsx api/boot.ts >/tmp/boot_kilo.log 2>&1 &
disown

up=0
for i in $(seq 1 60); do
  sleep 2
  if curl -sf http://127.0.0.1:3999/api/health >/dev/null 2>&1; then echo "server UP (attempt $i)"; up=1; break; fi
done
[ "$up" = 1 ] || { echo "server failed — tail:"; tail -20 /tmp/boot_kilo.log; exit 1; }

echo "== seed groq safety net (mock, priority 30) =="
DATABASE_URL="$MYSQL_URL" node scripts/seed_kilo_live.mjs

# give boot discovery a moment to pull the kilo /models catalog
sleep 12

echo "== run live checks =="
python3 scripts/kilo_live_local.py
RESULT=$?

echo "== kilo rows discovered =="
DATABASE_URL="$MYSQL_URL" node -e "
import('mysql2/promise').then(async (m) => {
  const c = await m.createConnection({ host: '127.0.0.1', port: 3306, user: 'user', password: 'pass', database: 'testdb' });
  const [p] = await c.query(\"SELECT id, slug, priority, enabled FROM aiProviders ORDER BY priority\");
  console.table(p);
  const [k] = await c.query(\"SELECT slug FROM aiProviders WHERE slug='kilocode'\");
  if (k.length) {
    const [rows] = await c.query(\"SELECT modelId, tier, isFree, supportsChat, supportsVision, contextLength FROM aiModels WHERE providerId=? AND isFree=1 ORDER BY tier, contextLength DESC\", [k[0].id]);
    console.log('kilo free models:', rows.length);
    for (const r of rows.slice(0, 12)) console.log(' ', JSON.stringify(r));
  }
  await c.end();
});
"

echo "== cleanup =="
pkill -f "tsx api/boot.ts" 2>/dev/null
pkill -f mock_openrouter.mjs 2>/dev/null
exit $RESULT
