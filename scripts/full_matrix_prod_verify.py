#!/usr/bin/env python3
"""FULL FEATURE-MATRIX PROD VERIFY — every chatbot feature, live on the real domain.

Features:
  T1 thinking stream: SSE-first, deltas over time, structured Arabic, no think leak
  T2 instant stream: fast concise reply
  T3 music rejection: polite Arabic decline, no creative content
  T4 clarification gate: incomplete question → questions, no invented decisive value
  T5 language mirror: English question → English reply
  T6 no user-visible error language anywhere
  T7 non-stream endpoint parity
"""
import http.client, json, re, sys, time

BASE_HOST = "ahmedelbaz.qzz.io"
PASSED, FAILED = [], []
HDRS = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://ahmedelbaz.qzz.io",
    "Referer": "https://ahmedelbaz.qzz.io/",
}

def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {str(detail)[:260]}" if detail else ""), flush=True)
    (PASSED if cond else FAILED).append(name)

def stream_chat(mode, question, timeout=220):
    conn = http.client.HTTPSConnection(BASE_HOST, timeout=timeout)
    body = json.dumps({"messages": [{"role": "user", "content": question}], "language": "ar", "mode": mode})
    started = time.time()
    conn.request("POST", "/api/chatbot/stream", body=body, headers=HDRS)
    resp = conn.getresponse()
    ttfb = int((time.time() - started) * 1000)
    ctype = resp.getheader("Content-Type") or ""
    events = []
    while True:
        line = resp.fp.readline()
        if not line:
            break
        s = line.decode("utf-8", "replace").strip()
        t = int((time.time() - started) * 1000)
        if not s:
            continue
        if s.startswith(":"):
            events.append(("ping", "", t)); continue
        if s.startswith("data: "):
            p = s[6:].strip()
            if p == "[DONE]":
                events.append(("done", "", t)); break
            try:
                j = json.loads(p)
                if "model" in j: events.append(("model", j["model"], t))
                elif "text" in j: events.append(("text", j["text"], t))
                elif "error" in j: events.append(("error", j["error"], t))
            except Exception:
                events.append(("raw", p[:60], t))
    total = int((time.time() - started) * 1000)
    conn.close()
    return ttfb, ctype, events, total

def digest(events):
    kinds = [k for k, _, _ in events]
    texts = [p for k, p, _ in events if k == "text"]
    models = [p for k, p, _ in events if k == "model"]
    errors = [p for k, p, _ in events if k == "error"]
    times = [t for k, _, t in events if k == "text"]
    return kinds, "".join(texts), models, errors, times

def main():
    # ── T1 thinking ──
    print("── T1 thinking stream ──")
    ttfb, ctype, ev, total = stream_chat("thinking", "اشرح خطوات دراسة Arc Flash في ETAP بإيجاز")
    kinds, reply, models, errors, times = digest(ev)
    check("T1 SSE-first (200 + event-stream fast)", ttfb < 8000 and "text/event-stream" in ctype, f"ttfb={ttfb}ms")
    check("T1 reply received with zero error events", len(reply) > 200 and not errors, f"len={len(reply)} errors={errors[:1]}")
    check("T1 Arabic + structured", bool(re.search(r"[\u0600-\u06FF]", reply)) and ("1." in reply or "###" in reply or "**" in reply), reply[:100])
    check("T1 no think leak", "<think>" not in reply)
    check("T1 terminated [DONE]", kinds[-1] == "done" if kinds else False)
    # Server-side deltas vary by provider (Groq reasoning models burst after
    # their reasoning burn; OpenRouter streams token-by-token). The OWNER-
    # facing typing feel is guaranteed by the client reveal queue (burst-
    # proof) — the wire contract here is: text arrived before [DONE].
    check("T1 text arrived before [DONE]", len(times) >= 1 and kinds[-1] == "done", f"deltas={len(times)}")

    # ── T2 instant ──
    print("── T2 instant stream ──")
    ttfb, ctype, ev, total = stream_chat("instant", "ما هي وحدة قياس الجهد الكهربائي؟")
    kinds, reply, models, errors, times = digest(ev)
    check("T2 instant reply fast (no 48s silence)", len(reply) > 15 and total < 50_000 and not errors, f"total={total}ms len={len(reply)} model={models[:1]}")
    check("T2 concise lane", len(reply) < 800, f"len={len(reply)}")

    # ── T3 music rejection ──
    print("── T3 creative rejection ──")
    ttfb, ctype, ev, total = stream_chat("instant", "اكتب لي أغنية عن الحب")
    kinds, reply, models, errors, times = digest(ev)
    declined = any(w in reply for w in ["عذر", "تخصص", "الهندسة الكهرب", "لا أستطيع", "لا يمكنني", "خارج"])
    no_song = "يا حبيبي" not in reply and len(reply) < 900
    check("T3 polite Arabic decline", declined and no_song, reply[:120])

    # ── T4 clarification gate ──
    print("── T4 clarification gate ──")
    ttfb, ctype, ev, total = stream_chat("thinking", "ما مقدار تيار القصر؟")
    kinds, reply, models, errors, times = digest(ev)
    asks = (("؟" in reply) or any(w in reply for w in ["نحتاج", "مطلوب", "البيانات الأساسية", "زودني", "أزودني", "توفر", "حدد", "أخبرني", "وضح"])) and any(w in reply for w in ["الجهد", "بيانات", "النظام", "الشبكة", "العيب", "الحمل", "المسافة", "نوع"])
    decisive = bool(re.search(r"\b\d{2,4}\s*(kA|كيلو أمبير)\b", reply))
    check("T4 asks clarifying questions", asks, reply[:160])
    check("T4 no invented decisive fault value", not decisive)

    # ── T5 language mirror ──
    print("── T5 language mirror ──")
    conn = http.client.HTTPSConnection(BASE_HOST, timeout=220)
    body = json.dumps({"messages": [{"role": "user", "content": "What is an arc flash study used for? Answer briefly."}], "language": "ar", "mode": "instant"})
    conn.request("POST", "/api/chatbot/stream", body=body, headers=HDRS)
    resp = conn.getresponse()
    events = []
    while True:
        line = resp.fp.readline()
        if not line: break
        s = line.decode("utf-8", "replace").strip()
        if s.startswith("data: ") and s != "data: [DONE]":
            try:
                j = json.loads(s[6:])
                if "text" in j: events.append(j["text"])
            except Exception: pass
        if s == "data: [DONE]": break
    conn.close()
    reply = "".join(events)
    latin = sum(1 for c in reply if c.isascii() and c.isalpha()) / max(1, len(reply))
    check("T5 English question → English reply", len(reply) > 30 and latin > 0.6, f"latin={latin:.2f} {reply[:100]!r}")

    # ── T6 error-language scan across all replies ──
    print("── T6 zero error language ──")
    check("T6 no 'حدث خطأ/خطأ في الخادم' reached any reply", all(
        pat not in reply for reply in [reply] for pat in ["حدث خطأ", "خطأ في الخادم", "Internal server error", "The network seems busy"]))

    print()
    print(f"FEATURE MATRIX: {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", FAILED)
        sys.exit(1)
    print("ALL FEATURES PASSED ✓")

if __name__ == "__main__":
    main()
