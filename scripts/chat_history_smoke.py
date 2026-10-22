"""Smoke test the chatbot router changes locally (guest paths, no DB needed).

Verifies:
  1. GET  /api/chatbot/history   → 401 for guests (auth gate works, no crash)
  2. DELETE /api/chatbot/history → 401 for guests
  3. POST /api/chatbot           → full guest path still works end-to-end
     (fake provider keys → all providers fail → 503 JSON, NOT a 500 crash —
     proves resolveOptionalUser + the new code path don't break the chat flow)
"""
import json, subprocess, time, urllib.request, urllib.error

BASE = "http://127.0.0.1:3999"

env_cmd = [
    "env", "DATABASE_URL=mysql://user:pass@127.0.0.1:3306/testdb",
    "APP_SECRET=local-test-secret-0123456789abcdef",
    "GOOGLE_CLIENT_ID=test.apps.googleusercontent.com",
    "SESSION_SECRET=local-session-0123456789abcdef",
    "JWT_SECRET=local-jwt-0123456789abcdef",
    "OPENROUTER_API_KEY=sk-or-test", "PORT=3999", "NODE_ENV=development",
    "npx", "tsx", "api/boot.ts",
]
server = subprocess.Popen(env_cmd, cwd="/home/z/my-project/work/elbaz-platform",
                          stdout=open("/tmp/boot_chathist.log", "w"), stderr=subprocess.STDOUT)
time.sleep(12)

fails, notes = [], []

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=90) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

# 1) guest history → 401
st, body = call("GET", "/api/chatbot/history")
ok1 = st == 401
notes.append(f"GET history guest: {st} {json.dumps(body)[:80]} -> {'PASS' if ok1 else 'FAIL'}")
if not ok1: fails.append("history guest not 401")

# 2) guest clear → 401
st, body = call("DELETE", "/api/chatbot/history")
ok2 = st == 401
notes.append(f"DELETE history guest: {st} -> {'PASS' if ok2 else 'FAIL'}")
if not ok2: fails.append("clear guest not 401")

# 3) guest chat round (no auth cookie) — full path must respond sanely
st, body = call("POST", "/api/chatbot", {
    "messages": [{"role": "user", "content": "مرحبا"}],
    "language": "ar", "mode": "instant",
})
ok3 = st in (200, 503) and isinstance(body, dict) and "success" in body
notes.append(f"POST chat guest: {st} success={body.get('success')} error={str(body.get('error'))[:60]} -> {'PASS' if ok3 else 'FAIL'}")
if not ok3: fails.append(f"chat guest unexpected: {st}")

# 4) malformed messages → 400 (normalize still guards)
st, body = call("POST", "/api/chatbot", {"messages": "not-an-array"})
ok4 = st == 400
notes.append(f"POST chat malformed: {st} -> {'PASS' if ok4 else 'FAIL'}")
if not ok4: fails.append("malformed not 400")

server.terminate()
print("\n".join(notes))
print("SMOKE:", "PASS" if not fails else f"FAIL {fails}")
