#!/usr/bin/env python3
"""Focused VISION probe — one image round via the real production stream."""
import http.client, json, base64, sys, time

BASE_HOST = "ahmedelbaz.qzz.io"
HDRS = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://ahmedelbaz.qzz.io",
    "Referer": "https://ahmedelbaz.qzz.io/",
}

img_path = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/work/elbaz-platform/public/etap-category.jpg"
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
ok = len(text) > 30 and not errors
print("VISION PROBE:", "PASS ✓" if ok else "FAIL ✗")
sys.exit(0 if ok else 1)
