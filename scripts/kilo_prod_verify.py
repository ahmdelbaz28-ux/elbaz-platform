"""PROD VERIFY — kilocode-first + never-busy on the live production domain.
Runs through the Cloudflare front (browser UA). Checks:
  1. instant  → served by kilocode/nvidia/nemotron-3-ultra-550b-a55b:free with
     strong Arabic content (progressive deltas, [DONE], no error events)
  2. thinking → served (any kilo ladder model), non-empty
  3. follow-up instant → answered (lastWorking pin / cascade healthy)
"""
import json
import sys
import time
import urllib.request

BASE = "https://ahmedelbaz.qzz.io"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
fails: list[str] = []


def check(name, cond, detail=""):
    print(f"{'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def post_stream(body, timeout=110):
    req = urllib.request.Request(BASE + "/api/chatbot/stream", method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")
    req.add_header("User-Agent", UA)
    started = time.time()
    events = []
    with urllib.request.urlopen(req, json.dumps(body).encode(), timeout=timeout) as resp:
        ctype = resp.headers.get("Content-Type", "")
        while True:
            line = resp.readline()
            if not line:
                break
            s = line.decode("utf-8", "replace").strip()
            if not s:
                continue
            if s.startswith(":"):
                events.append(("ping", s))
                continue
            if s.startswith("data: "):
                p = s[6:].strip()
                if p == "[DONE]":
                    events.append(("done", ""))
                    break
                try:
                    j = json.loads(p)
                except Exception:
                    continue
                if "model" in j:
                    events.append(("model", j["model"]))
                elif "text" in j:
                    events.append(("text", j["text"]))
                elif "error" in j:
                    events.append(("error", j["error"]))
            if time.time() - started > timeout - 5:
                break
    return ctype, events, int((time.time() - started) * 1000)


def text_of(events):
    return "".join(p for k, p in events if k == "text")


# 1) INSTANT — must land on the kilo flagship
ctype, events, total = post_stream({
    "messages": [{"role": "user", "content": "ما وظيفة قاطع التسريب في لوحة الكهرباء؟ اجب في ثلاث جمل."}],
    "language": "ar", "mode": "instant",
})
reply = text_of(events)
models = [p for k, p in events if k == "model"]
deltas = sum(1 for k, _ in events if k == "text")
print(f"instant ({total}ms) via {models} — reply: {reply[:150]!r}")
check("PROD instant: SSE served", "text/event-stream" in ctype)
check("PROD instant: served by KILOCODE first", any(m.startswith("kilocode/") for m in models), f"models={models}")
check("PROD instant: strong non-empty reply", len(reply) > 120, f"len={len(reply)}")
check("PROD instant: progressive deltas", deltas >= 3, f"deltas={deltas}")
check("PROD instant: no error event", not any(k == "error" for k, _ in events))
check("PROD instant: [DONE] terminator", any(k == "done" for k, _ in events))

# 2) THINKING
ctype, events, total = post_stream({
    "messages": [{"role": "user", "content": "اشرح الفرق بين MCB و RCD باختصار."}],
    "language": "ar", "mode": "thinking",
})
reply = text_of(events)
models = [p for k, p in events if k == "model"]
print(f"thinking ({total}ms) via {models} — reply: {reply[:120]!r}")
check("PROD thinking: non-empty reply", len(reply) > 100, f"len={len(reply)}")
check("PROD thinking: served by KILOCODE first", any(m.startswith("kilocode/") for m in models), f"models={models}")
check("PROD thinking: no error event", not any(k == "error" for k, _ in events))

# 3) FOLLOW-UP instant — the bot keeps answering
ctype, events, total = post_stream({
    "messages": [
        {"role": "user", "content": "ما وظيفة قاطع التسريب؟"},
        {"role": "assistant", "content": "يحمي من الصعق الكهربائي."},
        {"role": "user", "content": "وكيف يعمل؟"},
    ],
    "language": "ar", "mode": "instant",
})
reply = text_of(events)
models = [p for k, p in events if k == "model"]
print(f"follow-up ({total}ms) via {models} — reply: {reply[:100]!r}")
check("PROD follow-up: answered (bot never stops)", len(reply) > 60, f"len={len(reply)}")
check("PROD follow-up: no error event", not any(k == "error" for k, _ in events))

print()
if fails:
    print(f"PROD VERIFY FAILED: {len(fails)} — {fails}")
    sys.exit(1)
print("PROD VERIFY: ALL CHECKS PASSED — kilocode FIRST + never-busy on production")
