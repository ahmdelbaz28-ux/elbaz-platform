#!/usr/bin/env python3
"""
WEB GROUNDING E2E (Task 13) — local, zero-gap proof of the wiring.

Prereqs (managed by run_web_grounding_e2e.sh):
  - mock OpenRouter upstream on 127.0.0.1:47777 (scripts/mock_openrouter.mjs)
  - platform server on 127.0.0.1:3999 (api/boot.ts) with the test DB
  - aiProviders row slug='openrouter' → baseUrl http://127.0.0.1:47777/v1
    + models: mock/grounded + mock/grounded-stream (tier 2, ON),
      mock/charged (tier 1, OFF — T4 flips it on via seed script)

Proves through the PUBLIC API (two phases — the runner restarts the server
between them so the in-memory last-working pin from T1-T3 cannot outrank
the tier-1 charged model):
  main phase:
    T1  thinking (non-stream)  → upstream body HAS plugins [web]
    T2  instant  (non-stream)  → upstream body has NO plugins
    T3  thinking (stream)      → SSE flows + upstream body has plugins + stream=true
  t4 phase (after enable-charged + server restart):
    T4  402 breaker            → charged model: call1 WITH plugin → 402,
                                 call2 WITHOUT plugin → 200, client gets reply
"""
import json
import os
import subprocess
import sys
import time

import requests

BASE = "http://127.0.0.1:3999"
MOCK = "http://127.0.0.1:47777"
DB_URL = "mysql://user:pass@127.0.0.1:3306/testdb"
PASSED = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
    if cond:
        PASSED.append(name)
    else:
        print("E2E FAILED — aborting")
        sys.exit(1)


def enable_charged():
    env = {**os.environ, "DATABASE_URL": DB_URL}
    subprocess.run(["node", "scripts/seed_mock_provider.mjs", "enable-charged"], env=env, check=True, cwd=os.path.dirname(os.path.abspath(__file__)) + "/..")


def mock_log():
    return requests.get(f"{MOCK}/__log", timeout=5).json()


def mock_reset():
    requests.post(f"{MOCK}/__reset", timeout=5)


def wait_server(url, tries=40):
    for _ in range(tries):
        try:
            if requests.get(url, timeout=2).status_code < 500:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "main"
    check("platform server alive", wait_server(f"{BASE}/api/health"))
    check("mock upstream alive", wait_server(f"{MOCK}/__log"))

    if phase == "t4":
        run_t4()
        print(f"\nT4 RESULT: {len(PASSED)} checks passed")
        print("ALL GREEN ✅")
        return

    # ── T1: thinking non-stream → plugin attached ──
    mock_reset()
    r = requests.post(f"{BASE}/api/chatbot", json={
        "messages": [{"role": "user", "content": "ما آخر إصدار ETAP؟"}],
        "mode": "thinking",
    }, timeout=60)
    check("T1 thinking → HTTP 200", r.status_code == 200, f"got {r.status_code}: {r.text[:120]}")
    body = r.json()
    check("T1 thinking → success reply", body.get("success") is True and body.get("reply"))
    log = mock_log()
    check("T1 upstream called once", len(log) >= 1, f"log={log}")
    t1 = [c for c in log if not c["stream"] and c["model"] == "mock/grounded"]
    check("T1 upstream body HAS web plugin", t1 and t1[0]["plugins"] == [{"id": "web", "max_results": 3}], f"plugins={t1[0]['plugins'] if t1 else None}")

    # ── T2: instant non-stream → NO plugin ──
    mock_reset()
    r = requests.post(f"{BASE}/api/chatbot", json={
        "messages": [{"role": "user", "content": "سؤال سريع"}],
        "mode": "instant",
    }, timeout=60)
    check("T2 instant → HTTP 200", r.status_code == 200, f"got {r.status_code}")
    log = mock_log()
    t2 = [c for c in log if not c["stream"]]
    check("T2 upstream body has NO plugin", t2 and t2[0]["plugins"] is None, f"log={log}")

    # ── T3: thinking stream → SSE + plugin + stream:true ──
    mock_reset()
    r = requests.post(f"{BASE}/api/chatbot/stream", json={
        "messages": [{"role": "user", "content": "اشرح سير عمل دراسة الحماية"}],
        "mode": "thinking",
    }, timeout=60, stream=True)
    check("T3 stream → HTTP 200 SSE", r.status_code == 200 and "text/event-stream" in r.headers.get("Content-Type", ""))
    raw = r.raw.read(65536, decode_content=True).decode("utf-8", "replace")
    # keep reading until [DONE]
    for _ in range(50):
        if "[DONE]" in raw:
            break
        chunk = r.raw.read(65536, decode_content=True)
        if not chunk:
            break
        raw += chunk.decode("utf-8", "replace")
    check("T3 stream → model event first", '"model"' in raw.split("\n\n")[0])
    check("T3 stream → text deltas present", '"text"' in raw)
    check("T3 stream → terminated with [DONE]", "[DONE]" in raw)
    check("T3 stream → no raw <think> leak", "<think>" not in raw)
    time.sleep(0.5)
    log = mock_log()
    t3 = [c for c in log if c["stream"]]
    check("T3 upstream stream call HAS plugin", t3 and t3[0]["plugins"] == [{"id": "web", "max_results": 3}], f"log={log}")

    print(f"\nMAIN PHASE RESULT: {len(PASSED)} checks passed")
    print("ALL GREEN ✅")


def run_t4():
    """402-breaker phase — the runner enabled mock/charged (tier 1) and
    restarted the server, so the pool's first load sees charged first with
    no last-working pin in the way."""
    mock_reset()
    r = requests.post(f"{BASE}/api/chatbot", json={
        "messages": [{"role": "user", "content": "سؤال يمر على القاطع"}],
        "mode": "thinking",
    }, timeout=60)
    check("T4 402-breaker → HTTP 200 via retry", r.status_code == 200 and r.json().get("success") is True, f"got {r.status_code}: {r.text[:160]}")
    time.sleep(0.3)
    log = mock_log()
    charged = [c for c in log if c["model"] == "mock/charged"]
    check("T4 charged called twice (with plugin → 402 → without → 200)",
          len(charged) >= 2 and charged[0]["plugins"] is not None and charged[1]["plugins"] is None,
          f"charged={charged}")


if __name__ == "__main__":
    main()
