"""POLL DEPLOY — wait until the production bundle contains the push-fix marker.

The new code ships string literals that no previous build contains
("PUSH_SUBSCRIBE_BLOCKED"). Fetch the live index.html -> main JS bundle ->
grep for the marker. Exit 0 the moment ALL markers are live.

Usage: python3 scripts/poll_push_deploy.py [max_seconds]
"""

import json
import re
import sys
import time
import urllib.request

BASE = "https://ahmedelbaz.qzz.io"
MARKERS = ["PUSH_SUBSCRIBE_BLOCKED", "PUSH_ENV_IN_APP_BROWSER", "PUSH_INVALID_VAPID_KEY"]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}


def fetch(url: str, timeout: int = 30) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return 0, f"ERR {exc}"


def live_bundle_urls() -> list[str]:
    code, html = fetch(BASE + "/")
    if code != 200:
        print(f"  index → {code}")
        return []
    return sorted(set(re.findall(r"assets/[A-Za-z0-9_-]+\.js", html)))


def main() -> int:
    budget = int(sys.argv[1]) if len(sys.argv) > 1 else 540
    start = time.time()
    attempt = 0
    while time.time() - start < budget:
        attempt += 1
        urls = live_bundle_urls()
        if urls:
            # markers can live in any chunk; fetch the main ones (first 3, small)
            found: dict[str, bool] = {}
            for u in urls[:6]:
                code, body = fetch(f"{BASE}/{u}", timeout=40)
                for m in MARKERS:
                    if m not in found and m in body:
                        found[m] = True
            missing = [m for m in MARKERS if not found.get(m)]
            elapsed = time.time() - start
            if not missing:
                print(f"DEPLOYED after {elapsed:.0f}s — all {len(MARKERS)} markers live")
                return 0
            print(f"[{attempt}] {elapsed:.0f}s — markers missing: {missing} ({len(urls)} chunks scanned)")
        else:
            print(f"[{attempt}] {time.time()-start:.0f}s — index not reachable")
        time.sleep(30)
    print("BUDGET EXHAUSTED — deploy not confirmed")
    return 1


if __name__ == "__main__":
    sys.exit(main())
