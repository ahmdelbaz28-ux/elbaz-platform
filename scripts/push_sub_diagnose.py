"""PROD DIAGNOSTIC — Web Push subscription truth-test on live production.

Answers the user's "browser refused to create the push subscription" report:
  1. What does /api/notifications/push/public-key actually return?
  2. Is the VAPID key structurally valid (65 bytes, uncompressed point 0x04)?
  3. Does pushManager.subscribe() really succeed in a real Chromium with
     notifications granted — and if not, WHICH DOMException (name + message)?

Runs against BOTH origins the user can hit: the Cloudflare-fronted domain and
the direct hf.space origin. Console output is JSON per origin.

Usage: python3 scripts/push_sub_diagnose.py
"""

import json
import sys

from playwright.sync_api import sync_playwright

ORIGINS = [
    "https://ahmedelbaz.qzz.io",
    "https://ahmdelbaz28-ahmdrtap.hf.space",
]

# Runs INSIDE the page: inspect environment, fetch key, validate bytes,
# subscribe on the live SW, report the exact exception on failure.
PROBE_JS = """
async () => {
  const out = {};
  out.secureContext = window.isSecureContext;
  out.hasServiceWorker = 'serviceWorker' in navigator;
  out.hasPushManager = 'PushManager' in window;
  out.hasNotification = typeof Notification !== 'undefined';
  out.permission = out.hasNotification ? Notification.permission : 'none';
  out.ua = navigator.userAgent.slice(0, 160);

  // ── 1. server public key ──
  try {
    const r = await fetch('/api/notifications/push/public-key');
    out.keyHttp = r.status;
    const d = await r.json();
    out.enabled = d.enabled === true;
    out.key = d.publicKey || null;
    if (out.key) {
      out.keyLen = out.key.length;
      out.keyHead = out.key.slice(0, 6);
      out.keyPadded = out.key.includes('=');
      out.keyNonB64Url = /[^A-Za-z0-9_-]/.test(out.key);
      const pad = '='.repeat((4 - (out.key.length % 4)) % 4);
      const b64 = (out.key + pad).replaceAll('-', '+').replaceAll('_', '/');
      const raw = atob(b64);
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      out.keyBytes = bytes.length;
      out.keyFirstByte = bytes[0]; // 0x04 = valid uncompressed EC point
    }
  } catch (e) {
    out.keyError = String(e && e.message ? e.message : e).slice(0, 200);
  }

  // ── 2. SW ready + subscribe with the fetched key ──
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('SW_READY_TIMEOUT')), 15000)),
    ]);
    out.swScope = reg.scope;
    out.swActive = Boolean(reg.active);
    out.swPushListenerLoaded = Boolean(reg.active).valueOf() ? undefined : undefined;
    try {
      const probe = await fetch(reg.active.scriptURL.replace(/sw\\.js.*$/, 'push-sw.js'));
      out.pushSwFetchable = probe.ok;
    } catch { out.pushSwFetchable = 'probe-failed'; }

    if (out.key && out.keyFirstByte === 4 && out.keyBytes === 65) {
      const pad = '='.repeat((4 - (out.key.length % 4)) % 4);
      const b64 = (out.key + pad).replaceAll('-', '+').replaceAll('_', '/');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      try {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        });
        out.subscribed = true;
        out.endpointHost = new URL(sub.endpoint).host;
        const j = sub.toJSON();
        out.subHasKeys = Boolean(j.keys && j.keys.p256dh && j.keys.auth);
        try { await sub.unsubscribe(); out.cleanedUp = true; } catch { out.cleanedUp = false; }
      } catch (e) {
        out.subscribed = false;
        out.errName = e.name;
        out.errMessage = String(e.message || '').slice(0, 300);
      }
    } else {
      out.subscribed = false;
      out.skipped = 'key structurally invalid or missing';
    }
  } catch (e) {
    out.swError = String(e && e.message ? e.message : e).slice(0, 200);
  }
  return out;
}
"""


def probe(origin: str) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        context.grant_permissions(["notifications"], origin=origin)
        page = context.new_page()
        console_lines: list[str] = []
        page.on("console", lambda m: console_lines.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: console_lines.append(f"pageerror: {e}"))
        result: dict = {"origin": origin, "ok": False}
        try:
            page.goto(origin, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(2_500)  # SW registration + hydration
            result["probe"] = page.evaluate(PROBE_JS)
            result["ok"] = True
        except Exception as exc:  # noqa: BLE001 — diagnostic must never crash
            result["error"] = str(exc).slice if False else str(exc)[:300]
        result["console_tail"] = console_lines[-12:]
        browser.close()
        return result


def main() -> int:
    verdicts = []
    for origin in ORIGINS:
        res = probe(origin)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        print("-" * 72)
        p = res.get("probe", {})
        verdicts.append(
            (origin, p.get("subscribed") is True,
             p.get("keyBytes"), p.get("keyFirstByte"),
             p.get("errName"), p.get("errMessage"))
        )
    print("VERDICT")
    for origin, ok, kbytes, fb, name, msg in verdicts:
        print(f"  {origin}\n    subscribe_ok={ok} key_bytes={kbytes} first_byte={fb} err={name}: {msg}")
    any_ok = any(v[1] for v in verdicts)
    print(f"  ANY_SUBSCRIBE_OK={any_ok}")
    return 0 if any_ok else 1


if __name__ == "__main__":
    sys.exit(main())
