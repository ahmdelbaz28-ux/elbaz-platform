"""NEVER-BUSY e2e — the owner's contract: the user must NEVER see a "network
busy" error; the bot keeps thinking (SSE-first + keepalives + silent walk
rounds) until a model answers.

Usage: python3 scripts/neverbusy_e2e.py <phase> <persist_ms>
  phase ∈ {t1, t2, t3} — the bash runner seeds + restarts the server per phase.
  t1  daily-429 storm    → 200 SSE immediately, keepalives, persistence until
                           the deadline, then ONE soft busy event (no text).
  t2  slow winner        → SSE headers + `: ping` BEFORE the first content
                           delta; full reply assembled; [DONE].
  t3  breaker hand-off   → OpenRouter daily-429 trips the breaker; the Groq
                           provider answers on the SAME request (and the next).
"""
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


def post_stream(body):
    """POST /api/chatbot/stream and read the SSE stream.
    Returns (ttfb_ms, ctype, events, total_ms); events = [(kind, payload)]."""
    conn = http.client.HTTPConnection(HOST, PORT, timeout=90)
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    started = time.time()
    conn.request("POST", "/api/chatbot/stream", body=json.dumps(body), headers=headers)
    resp = conn.getresponse()
    ttfb_ms = int((time.time() - started) * 1000)
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
                events.append(("raw", payload))
                continue
            if "model" in parsed:
                events.append(("model", parsed["model"]))
            elif "text" in parsed:
                events.append(("text", parsed["text"]))
            elif "error" in parsed:
                events.append(("error", parsed["error"]))
        if time.time() - started > 80:
            break
    total_ms = int((time.time() - started) * 1000)
    conn.close()
    return ttfb_ms, ctype, events, total_ms


def text_of(events):
    return "".join(p for k, p in events if k == "text")


def t1(persist_ms):
    msg = {"messages": [{"role": "user", "content": "ما هي خطوات الحماية في ETAP؟"}], "language": "ar", "mode": "thinking"}
    ttfb, ctype, events, total = post_stream(msg)
    check("T1 SSE-first: HTTP 200 + text/event-stream immediately", ttfb < 3000 and "text/event-stream" in ctype, f"ttfb={ttfb}ms ctype={ctype}")
    check("T1 keepalives: at least one `: ping` while the walk persisted", any(k == "ping" for k, _ in events))
    check("T1 persistence: stream lived ≥ deadline − 1s", total >= persist_ms - 1000, f"total={total}ms (deadline {persist_ms}ms)")
    check("T1 zero text events during the storm", not any(k == "text" for k, _ in events))
    soft_errors = [p for k, p in events if k == "error"]
    check("T1 exactly one soft busy event at the end", len(soft_errors) == 1 and ("ضغط عالٍ" in soft_errors[0] or "heavy load" in soft_errors[0]), repr(soft_errors[:1]))
    check("T1 stream terminated with [DONE]", events[-1][0] == "done" if events else False)


def t2(_persist_ms):
    msg = {"messages": [{"role": "user", "content": "اشرح الحماية"}], "language": "ar", "mode": "thinking"}
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    check("T2 SSE-first: 200 + event-stream before the 6s upstream", ttfb < 3000 and "text/event-stream" in ctype, f"ttfb={ttfb}ms")
    first_ping = next((i for i, k in enumerate(kinds) if k == "ping"), None)
    first_text = next((i for i, k in enumerate(kinds) if k == "text"), None)
    check("T2 `: ping` arrived BEFORE the first content delta", first_ping is not None and first_text is not None and first_ping < first_text, f"ping@{first_ping} text@{first_text} of {len(kinds)} events")
    reply = text_of(events)
    check("T2 full reply assembled", "بداية الرد البطيء" in reply and "والكمال بعده" in reply, repr(reply[:60]))
    check("T2 model event present", any(k == "model" for k, _ in events))
    check("T2 terminated with [DONE]", kinds[-1] == "done" if kinds else False)


def t3(_persist_ms):
    msg = {"messages": [{"role": "user", "content": "اشرح الحماية"}], "language": "ar", "mode": "thinking"}
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    reply = text_of(events)
    check("T3 Groq answers after the OpenRouter breaker trips", any(k == "text" for k, _ in events) and "موثق" in reply, f"reply={reply[:60]!r} total={total}ms")
    check("T3 no error event", not any(k == "error" for k, _ in events))
    check("T3 fast hand-off (< 15s total)", total < 15_000, f"total={total}ms")
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    check("T3 follow-up request also answers (breaker only skips OpenRouter)", any(k == "text" for k, _ in events) and not any(k == "error" for k, _ in events))


if __name__ == "__main__":
    phase = (sys.argv[1] if len(sys.argv) > 1 else "t1").lower()
    persist_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    {"t1": t1, "t2": t2, "t3": t3}[phase](persist_ms)
    print()
    if fails:
        print(f"PHASE {phase.upper()} FAILED: {len(fails)} — {fails}")
        sys.exit(1)
    print(f"PHASE {phase.upper()} PASSED")
