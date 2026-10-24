#!/usr/bin/env python3
"""Focused VISION probe — one image round via the real production stream."""
import http.client, json, base64, sys, time
from pathlib import Path

BASE_HOST = "ahmedelbaz.qzz.io"
HDRS = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://ahmedelbaz.qzz.io",
    "Referer": "https://ahmedelbaz.qzz.io/",
}

REPO_ROOT = Path(__file__).resolve().parent.parent
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
# S8707 — the CLI value is untrusted input that reaches open(): resolve it and
# enforce an allowlist (inside the repo + image extension) before any read.
img_path = Path(sys.argv[1] if len(sys.argv) > 1 else REPO_ROOT / "public" / "etap-category.jpg").resolve()
if not img_path.is_relative_to(REPO_ROOT):
    sys.exit("image path must stay inside the project directory")
if img_path.suffix.lower() not in IMAGE_SUFFIXES:
    sys.exit("only image files (.jpg/.jpeg/.png/.webp/.gif) are accepted")
with open(img_path, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
dataurl = f"data:image/jpeg;base64,{b64}"
print(f"image bytes b64={len(b64)}")

conn = http.client.HTTPSConnection(BASE_HOST, timeout=280)
body = json.dumps({
    "messages": [{"role": "user", "content": [
        {"type": "text", "text": "ما الذي تظهره هذه الصورة؟ اذكر نوع البرنامج الظاهر فيها بإيجاز"},
        {"type": "image_url", "image_url": {"url": dataurl}},
    ]}],
    "language": "ar",
    "mode": "thinking",
})
started = time.time()
conn.request("POST", "/api/chatbot/stream", body=body, headers=HDRS)
resp = conn.getresponse()
print("status:", resp.status, resp.getheader("Content-Type"))
text, model, errors, pings = "", [], [], 0
while True:
    line = resp.fp.readline()
    if not line:
        break
    s = line.decode("utf-8", "replace").strip()
    if not s:
        continue
    if s.startswith(":"):
        pings += 1
        continue
    if s.startswith("data: "):
        p = s[6:].strip()
        if p == "[DONE]":
            break
        try:
            j = json.loads(p)
            if "text" in j: text += j["text"]
            elif "model" in j: model.append(j["model"])
            elif "error" in j: errors.append(j["error"])
        except Exception:
            pass
total = int((time.time() - started) * 1000)
conn.close()
print(f"total={total}ms pings={pings} model={model[:1]} errors={errors[:1]}")
print(f"reply_len={len(text)}")
print("reply_head:", text[:220])
# The honesty-note path (image unreadable) is a FAILURE, not a pass — the
# probe used to bless "عذراً، تعذّر قراءة الصورة…" replies as healthy.
honesty_failure = ("تعذّر قراءة الصورة" in text) or ("could not be read" in text.lower())
ok = len(text) > 30 and not errors and not honesty_failure
print("VISION PROBE:", "PASS ✓" if ok else "FAIL ✗" + (" (honesty-note reply — image was NOT read)" if honesty_failure else ""))
sys.exit(0 if ok else 1)
