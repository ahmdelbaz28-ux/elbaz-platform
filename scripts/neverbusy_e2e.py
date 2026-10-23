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


def t5(_persist_ms):
    """VISION POLICY (garbled-Arabic incident): an image message must be
    answered by the TEXT reasoning cascade — never by a vision model.
    mock/vl-reader (vision, tier1) serves the PASS-1 read when the request
    carries image parts and REFUSES (500) persona-prompt requests; the final
    answer must therefore come from mock/grounded-stream (tier2, text)."""
    msg = {
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "ما الذي تشاهده في الصورة؟"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            ],
        }],
        "language": "ar",
        "mode": "instant",
    }
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    reply = text_of(events)
    models = [p for k, p in events if k == "model"]
    check("T5 vision reply served (two-pass pipeline completed)", len(reply) > 0, f"reply={reply[:60]!r} total={total}ms")
    check("T5 answer came from the TEXT cascade (grounded-stream marker)", "موثق" in reply and "متدفق" in reply, repr(reply[:60]))
    check("T5 winner is the text model, never the VL id", any("grounded-stream" in m for m in models) and not any("vl-reader" in m for m in models), f"models={models}")
    check("T5 progressive deltas (streamed, not one dump)", sum(1 for k, _ in events if k == "text") >= 2, f"deltas={sum(1 for k,_ in events if k=='text')}")
    check("T5 no error event reached the client", not any(k == "error" for k, _ in events))
    check("T5 terminated with [DONE]", kinds[-1] == "done" if kinds else False)
    check("T5 completes well inside the vision deadline (< 40s)", total < 40_000, f"total={total}ms")


def t4(_persist_ms):
    """Dud winner: peeks alive (reasoning delta) then dies with ZERO visible
    content. The resilient-stream layer must repair the answer in-flight
    (streaming rescue on the next candidate), and — if that also failed — the
    endpoint's zero-content re-walk serves the user in the SAME request.
    Either way: the client receives real content, never an empty reply."""
    msg = {"messages": [{"role": "user", "content": "اشرح الحماية"}], "language": "ar", "mode": "thinking"}
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    reply = text_of(events)
    models = [p for k, p in events if k == "model"]
    check("T4 dud winner: reply is NOT empty (rescue/re-walk served us)", len(reply) > 0, f"reply={reply[:60]!r} total={total}ms")
    check("T4 content came from the healthy tier-2 streamer", "موثق" in reply and "متدفق" in reply, repr(reply[:60]))
    check("T4 dud winner announced before content", len(models) >= 1 and any("dud" in m for m in models), f"models={models}")
    check("T4 no error event reached the client", not any(k == "error" for k, _ in events))
    check("T4 terminated with [DONE]", kinds[-1] == "done" if kinds else False)
    check("T4 fast recovery (< 20s total)", total < 20_000, f"total={total}ms")


def t6(_persist_ms):
    """KILO-LANE cascade — the owner's contract: kilocode is the FIRST
    provider; when its free models are exhausted one by one (quota 429s, dead
    404s) the walk moves to the NEXT model until EVERY kilo model is spent,
    then hands off to groq — the bot NEVER stops, and the cooling kilo models
    are skipped instantly on the follow-up request."""
    msg = {"messages": [{"role": "user", "content": "اشرح الحماية"}], "language": "ar", "mode": "thinking"}
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    reply = text_of(events)
    models = [p for k, p in events if k == "model"]
    check("T6 first request: reply served despite BOTH kilo models being unusable", "موثق" in reply and "متدفق" in reply, f"reply={reply[:60]!r} total={total}ms")
    check("T6 hand-off landed on groq (kilocode exhausted first)", len(models) >= 1 and all("groq" in m for m in models), f"models={models}")
    check("T6 no error event reached the client", not any(k == "error" for k, _ in events))
    check("T6 terminated with [DONE]", kinds[-1] == "done" if kinds else False)
    check("T6 full kilo exhaustion + groq answer < 15s", total < 15_000, f"total={total}ms")
    # Follow-up: cooling breakers must make the walk skip kilocode instantly.
    ttfb, ctype, events, total = post_stream(msg)
    kinds = [k for k, _ in events]
    reply = text_of(events)
    models = [p for k, p in events if k == "model"]
    check("T6 follow-up still answered (bot never stops)", "موثق" in reply and "متدفق" in reply, f"total={total}ms")
    check("T6 follow-up went straight to groq (kilos cooling)", all("groq" in m for m in models), f"models={models}")
    check("T6 follow-up fast (< 5s — no wasted kilo attempts)", total < 5_000, f"total={total}ms")



if __name__ == "__main__":
    phase = (sys.argv[1] if len(sys.argv) > 1 else "t1").lower()
    persist_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    {"t1": t1, "t2": t2, "t3": t3, "t4": t4, "t5": t5, "t6": t6}[phase](persist_ms)
    print()
    if fails:
        print(f"PHASE {phase.upper()} FAILED: {len(fails)} — {fails}")
        sys.exit(1)
    print(f"PHASE {phase.upper()} PASSED")
