#!/usr/bin/env python3
"""PROD VERIFY — never-busy + streaming UX contract, live on hf.space.
Uses the documented Sec-Fetch-Dest: iframe exception (EDGE_HOST_ENFORCE)."""
import http.client
import json
import sys
import time

BASE_HOST = "ahmedelbaz.qzz.io"
PASSED = []
FAILED = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {str(detail)[:300]}" if detail else ""))
    (PASSED if cond else FAILED).append(name)


def stream_chat(mode, question, timeout=200):
    conn = http.client.HTTPSConnection(BASE_HOST, timeout=timeout)
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Origin": "https://ahmedelbaz.qzz.io",
        "Referer": "https://ahmedelbaz.qzz.io/",
    }
    body = json.dumps({
        "messages": [{"role": "user", "content": question}],
        "language": "ar",
        "mode": mode,
    })
    started = time.time()
    conn.request("POST", "/api/chatbot/stream", body=body, headers=headers)
    resp = conn.getresponse()
    ttfb = int((time.time() - started) * 1000)
    ctype = resp.getheader("Content-Type") or ""
    events = []  # (kind, payload, t_ms)
    while True:
        line = resp.fp.readline()
        if not line:
            break
        s = line.decode("utf-8", "replace").strip()
        t = int((time.time() - started) * 1000)
        if not s:
            continue
        if s.startswith(":"):
            events.append(("ping", s, t))
            continue
        if s.startswith("data: "):
            payload = s[6:].strip()
            if payload == "[DONE]":
                events.append(("done", "", t))
                break
            try:
                parsed = json.loads(payload)
            except Exception:
                events.append(("raw", payload, t))
                continue
            if "model" in parsed:
                events.append(("model", parsed["model"], t))
            elif "text" in parsed:
                events.append(("text", parsed["text"], t))
            elif "error" in parsed:
                events.append(("error", parsed["error"], t))
        if time.time() - started > timeout:
            break
    total = int((time.time() - started) * 1000)
    conn.close()
    return ttfb, ctype, events, total


def main():
    q = "إيه خطوات عمل دراسة Arc Flash في ETAP بالترتيب؟"

    # ── P1: THINKING via stream — the exact scenario that produced the red error ──
    ttfb, ctype, events, total = stream_chat("thinking", q)
    kinds = [k for k, _, _ in events]
    reply = "".join(p for k, p, _ in events if k == "text")
    model_ev = [p for k, p, _ in events if k == "model"]
    check("P1 stream 200 + SSE headers fast", "text/event-stream" in ctype and ttfb < 5000, f"ttfb={ttfb}ms ctype={ctype}")
    check("P1 model event present", len(model_ev) >= 1, model_ev[:1])
    check("P1 reply received (no busy error)", len(reply) > 300 and not any(k == "error" for k in kinds), f"len={len(reply)} total={total}ms")
    check("P1 Arabic engineering reply", "ETAP" in reply or "القوس" in reply or "حماية" in reply, reply[:160])
    check("P1 structured (numbered/bullets)", ("1." in reply or "•" in reply or "-" in reply or "###" in reply))
    check("P1 no think leak", "<think>" not in reply and "</think>" not in reply)
    text_times = [t for k, _, t in events if k == "text"]
    check("P1 incremental streaming (deltas over time)", len(text_times) >= 3 and (text_times[-1] - text_times[0]) > 300, f"deltas={len(text_times)} span={text_times[-1]-text_times[0] if len(text_times)>1 else 0}ms")
    check("P1 terminated with [DONE]", kinds[-1] == "done")
    print(f"   P1 model={model_ev[:1]} reply-head={reply[:200]!r}")

    # ── P2: INSTANT via stream — fast lane ──
    ttfb2, ctype2, events2, total2 = stream_chat("instant", "حاسب أقصى تحميل على كابل 4×25مم² نحاس 380 فولت؟")
    kinds2 = [k for k, _, _ in events2]
    reply2 = "".join(p for k, p, _ in events2 if k == "text")
    check("P2 instant streamed reply", len(reply2) > 50 and not any(k == "error" for k in kinds2), f"len={len(reply2)} total={total2}ms model={[p for k,p,_ in events2 if k=='model'][:1]}")
    check("P2 instant terminates with [DONE]", kinds2[-1] == "done")
    print(f"   P2 reply-head={reply2[:160]!r}")

    print()
    if FAILED:
        print(f"PROD VERIFY FAILED: {FAILED}")
        sys.exit(1)
    print("PROD VERIFY: ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
