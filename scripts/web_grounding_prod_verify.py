#!/usr/bin/env python3
"""
PRODUCTION VERIFICATION (Task 16) — web reach + accuracy contract, live.
Uses the documented Sec-Fetch-Dest: iframe exception against hf.space.
"""
import json
import sys
import time

import requests

BASE = "https://ahmdelbaz28-ahmdrtap.hf.space"
HDRS = {"Sec-Fetch-Dest": "iframe", "Content-Type": "application/json"}
PASSED = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail[:400]}" if detail else ""))
    if cond:
        PASSED.append(name)
    else:
        print("PROD VERIFY FAILED")
        sys.exit(1)


def chat(messages, mode, timeout=170):
    r = requests.post(f"{BASE}/api/chatbot", headers=HDRS, json={"messages": messages, "mode": mode}, timeout=timeout)
    return r


def main():
    # ── P1: thinking + expert ETAP question → documented, formatted answer ──
    t0 = time.time()
    r = chat([{"role": "user", "content": "إيه الفرق بين دراسة Load Flow ودراسة Short Circuit في ETAP وامتى أستخدم كل واحدة؟"}], "thinking")
    dt = time.time() - t0
    body = r.json()
    check("P1 thinking → 200/success", r.status_code == 200 and body.get("success"), f"{r.status_code} {str(body)[:120]}")
    reply = body.get("reply", "")
    check("P1 reply is substantial+structured", len(reply) > 300 and ("1." in reply or "###" in reply or "-" in reply or "•" in reply), f"len={len(reply)} {dt:.1f}s model={body.get('model')}")
    check("P1 no provider leak", "OpenRouter" not in reply and "openrouter" not in reply)
    print(f"   P1 reply head: {reply[:220]!r}")

    # ── P2: instant → short, fast, distinct mode ──
    t0 = time.time()
    r2 = chat([{"role": "user", "content": "إيه الفرق بين دراسة Load Flow ودراسة Short Circuit في ETAP وامتى أستخدم كل واحدة؟"}], "instant")
    dt2 = time.time() - t0
    b2 = r2.json()
    check("P2 instant → 200/success", r2.status_code == 200 and b2.get("success"), f"{r2.status_code}")
    r2reply = b2.get("reply", "")
    check("P2 instant shorter than thinking", len(r2reply) < len(reply), f"len(instant)={len(r2reply)} < len(thinking)={len(reply)}, {dt2:.1f}s model={b2.get('model')}")
    check("P2 distinct model tag", b2.get("model") != body.get("model"), f"{b2.get('model')} vs {body.get('model')}")
    print(f"   P2 reply head: {r2reply[:160]!r}")

    # ── P3: ambiguous design question → clarifying gate, no decisive answer ──
    r3 = chat([{"role": "user", "content": "صمم لي نظام حماية كامل"}], "thinking")
    b3 = r3.json()
    check("P3 ambiguous → 200", r3.status_code == 200 and b3.get("success"), f"{r3.status_code}")
    rep3 = b3.get("reply", "")
    has_questions = rep3.count("؟") >= 2 or "1." in rep3 and "؟" in rep3
    check("P3 ambiguous → asks clarifying set (≥2 questions)", has_questions, f"q_marks={rep3.count('؟')}")
    # no invented decisive values
    import re as _re
    decisive_kv = bool(_re.search(r"(=|يравي|يساوي)\s*\d+\s*(A|kA|V|s\b)", rep3))
    check("P3 no invented decisive settings", not decisive_kv, f"reply head: {rep3[:180]!r}")

    # ── P4: non-engineering (music) → polite decline ──
    r4 = chat([{"role": "user", "content": "ألحن لي أغنية جميلة عن الكهرباء"}], "thinking")
    b4 = r4.json()
    rep4 = b4.get("reply", "")
    check("P4 music → polite decline, no song", r4.status_code == 200 and b4.get("success") and ("أسف" in rep4 or "اعتذر" in rep4 or "تخصص" in rep4 or "خارج" in rep4) and len(rep4) < 800, f"len={len(rep4)} head={rep4[:140]!r}")

    # ── P5: version/fresh-info probe (web plugin exercise) ──
    r5 = chat([{"role": "user", "content": "ما هو أحدث إصدار من برنامج ETAP حالياً؟"}], "thinking")
    b5 = r5.json()
    rep5 = b5.get("reply", "")
    check("P5 version question → 200 + honest/documented", r5.status_code == 200 and b5.get("success") and len(rep5) > 60, f"len={len(rep5)} model={b5.get('model')}")
    cite_or_honest = ("http" in rep5 or "etap.com" in rep5.lower() or "ETAP" in rep5)
    check("P5 reply references a source/product", cite_or_honest, f"head={rep5[:180]!r}")

    # ── P6: streaming thinking → SSE structure ──
    with requests.post(f"{BASE}/api/chatbot/stream", headers=HDRS, json={"messages": [{"role": "user", "content": "اشرح خطوات دراسة Arc Flash في ETAP بإيجاز"}], "mode": "thinking"}, timeout=170, stream=True) as r6:
        check("P6 stream → 200 SSE", r6.status_code == 200 and "text/event-stream" in r6.headers.get("Content-Type", ""))
        raw = ""
        for chunk in r6.iter_content(chunk_size=4096, decode_unicode=True):
            raw += chunk
            if "[DONE]" in raw:
                break
    check("P6 stream → model event + text + [DONE]", '"model"' in raw.split("\n\n")[0] and '"text"' in raw and "[DONE]" in raw, f"bytes={len(raw)}")
    check("P6 stream → no <think> leak", "<think>" not in raw)

    # ── P7: Arabic reply language mirror on English question ──
    r7 = chat([{"role": "user", "content": "What is relay coordination CTI typical value?"}], "thinking")
    b7 = r7.json()
    rep7 = b7.get("reply", "")
    is_ar = any("\u0600" <= ch <= "\u06FF" for ch in rep7)
    is_en = rep7.isascii() or not is_ar
    check("P7 language mirror (English q → English reply)", b7.get("success") and is_en and not is_ar, f"head={rep7[:120]!r}")

    print(f"\nPROD VERIFY: {len(PASSED)}/14 checks passed — ALL GREEN ✅")


if __name__ == "__main__":
    main()
