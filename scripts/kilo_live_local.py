"""KILO LIVE LOCAL e2e — real kilocode gateway as FIRST provider + mock groq
safety net. Verifies the owner contract end-to-end with the REAL upstream:
  1. instant lane → served by the kilo flagship (nemotron-3-ultra-550b) with
     strong Arabic content,
  2. thinking lane → also served (any kilo ladder model),
  3. vision lane → image question served by the kilo vision model (super-vl).
Run inside scripts/kilo_live_e2e.sh (server already up on :3999).
"""
import base64
import http.client
import json
import sys
import time

HOST, PORT = "127.0.0.1", 3999
fails: list[str] = []


def check(name, cond, detail=""):
    print(f"{'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def post_stream(body, timeout=120):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    started = time.time()
    conn.request("POST", "/api/chatbot/stream", body=json.dumps(body), headers=headers)
    resp = conn.getresponse()
    ctype = resp.getheader("Content-Type") or ""
    events = []
    while True:
        line = resp.fp.readline()
        if not line:
            break
        s = line.decode("utf-8", "replace").strip()
        if not s:
            continue
        if s.startswith(":"):
            events.append(("ping", s))
            continue
        if s.startswith("data: "):
            payload = s[6:].strip()
            if payload == "[DONE]":
                events.append(("done", ""))
                break
            try:
                parsed = json.loads(payload)
            except Exception:
                continue
            if "model" in parsed:
                events.append(("model", parsed["model"]))
            elif "text" in parsed:
                events.append(("text", parsed["text"]))
            elif "error" in parsed:
                events.append(("error", parsed["error"]))
        if time.time() - started > timeout - 5:
            break
    total_ms = int((time.time() - started) * 1000)
    conn.close()
    return ctype, events, total_ms


def text_of(events):
    return "".join(p for k, p in events if k == "text")


# ── 1. INSTANT lane on the real kilo flagship ──
ctype, events, total = post_stream({
    "messages": [{"role": "user", "content": "ما وظيفة قاطع التسريب في لوحة الكهرباء؟ اجب باختصار في ثلاث جمل."}],
    "language": "ar", "mode": "instant",
})
reply = text_of(events)
models = [p for k, p in events if k == "model"]
print(f"instant reply ({total}ms) via {models}: {reply[:180]!r}")
check("INSTANT: SSE stream served", "text/event-stream" in ctype)
check("INSTANT: non-empty strong reply", len(reply) > 60, f"len={len(reply)}")
check("INSTANT: served by kilocode first", any(m.startswith("kilocode/") for m in models), f"models={models}")
check("INSTANT: no error event", not any(k == "error" for k, _ in events))

# ── 2. THINKING lane ──
ctype, events, total = post_stream({
    "messages": [{"role": "user", "content": "اشرح الفرق بين قاطع MCB وقاطع RCD من حيث وظيفة كل منهما."}],
    "language": "ar", "mode": "thinking",
})
reply = text_of(events)
models = [p for k, p in events if k == "model"]
print(f"thinking reply ({total}ms) via {models}: {reply[:180]!r}")
check("THINKING: non-empty reply", len(reply) > 80, f"len={len(reply)}")
check("THINKING: served by kilocode first", any(m.startswith("kilocode/") for m in models), f"models={models}")
check("THINKING: no error event", not any(k == "error" for k, _ in events))

# ── 3. VISION lane — 1×1 red PNG, question in Arabic ──
png = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080200000090775"
    "3de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082"
)).decode()
ctype, events, total = post_stream({
    "messages": [{"role": "user", "content": [
        {"type": "text", "text": "ما لون هذه الصورة؟ جاوب بكلمة واحدة."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png}"}},
    ]}],
    "language": "ar", "mode": "instant",
})
reply = text_of(events)
models = [p for k, p in events if k == "model"]
print(f"vision reply ({total}ms) via {models}: {reply[:120]!r}")
check("VISION: answered", len(reply) > 0, f"reply={reply[:60]!r}")
check("VISION: served by kilocode (super-vl ladder)", any(m.startswith("kilocode/") for m in models), f"models={models}")

print()
if fails:
    print(f"KILO LIVE LOCAL FAILED: {len(fails)} — {fails}")
    sys.exit(1)
print("KILO LIVE LOCAL: ALL CHECKS PASSED")
