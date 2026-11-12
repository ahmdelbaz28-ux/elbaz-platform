#!/usr/bin/env python3
"""YT PLAYLIST RELAY — fetch the channel playlist from a clean-egress machine
(GitHub Actions runner) and push verbatim rows to the Space's ingest endpoint.

WHY: HF Space egress to YouTube is throttled (429s) — GitHub runners are not.
The relay carries ONLY public data (video ids + titles YouTube shows to any
browser) and is authenticated with HMAC-SHA256(SYNC_INGEST_SECRET, body).

Usage:
  SYNC_INGEST_SECRET=... python3 scripts/yt_playlist_relay.py [--dry-run]

Sources (same layered order as the server watcher):
  1. InnerTube browse JSON (compact, throttling-resistant)
  2. Playlist page HTML (lockupViewModel / playlistVideoRenderer)
Merged by union, first non-empty title wins, unavailable-video titles dropped.
"""
import hashlib
import hmac
import json
import time
import os
import re
import sys
import urllib.request

PLAYLIST_ID = os.environ.get("YOUTUBE_PLAYLIST_ID", "PLeeb5_Qjhcgc")
INGEST_URL = os.environ.get(
    "YT_INGEST_URL",
    "https://ahmdelbaz28-ahmdrtap.hf.space/api/yt-sync/ingest",
)
SECRET = os.environ.get("SYNC_INGEST_SECRET", "")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
VIDEO_ID_RE = re.compile(r"^[\w-]{11}$")
# ✅ ROOT-CURE (2026-11-13): the relay fetches with hl=ar, so YouTube serves
# ARABIC placeholder titles ("فيديو خاص" / "فيديو محذوف" / "الفيديو غير متاح")
# for private/deleted videos — the English-only list let them through and the
# server published them as real lessons. Both languages are now filtered
# here AND again server-side (api/yt-sync-ingest.ts, defense in depth).
UNAVAILABLE_TITLES = (
    "private video", "deleted video", "unavailable", "video unavailable",
    "فيديو خاص", "فيديو محذوف", "الفيديو غير متاح", "هذا الفيديو غير متاح",
)
# Anti-replay: sign body + "." + ts and send the ts; the server rejects
# timestamps outside a 10-minute window.
TS_WINDOW_SECONDS = 600
# Payload chunking — the ingest schema caps a single push; a playlist larger
# than one chunk is pushed as several ordered requests instead of failing.
CHUNK_SIZE = 100


def http(url, data=None, headers=None, timeout=25):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=timeout)


def parse_innertube():
    body = json.dumps({
        "context": {"client": {"clientName": "WEB", "clientVersion": "2.20241001.00.00", "hl": "ar", "gl": "EG"}},
        "browseId": "VL" + PLAYLIST_ID,
    }).encode()
    try:
        with http(
            "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
            data=body,
            headers={"Content-Type": "application/json", "Accept-Language": "ar,en;q=0.8"},
        ) as res:
            payload = json.loads(res.read().decode())
    except Exception as exc:
        print(f"innertube fetch failed: {exc}")
        return []

    out, seen = [], set()

    def find_title(node):
        if isinstance(node, dict):
            t = node.get("title")
            if isinstance(t, dict):
                if isinstance(t.get("content"), str):
                    return t["content"]
                if isinstance(t.get("runs"), list) and t["runs"]:
                    return t["runs"][0].get("text", "")
            for v in node.values():
                r = find_title(v)
                if r:
                    return r
        elif isinstance(node, list):
            for c in node:
                r = find_title(c)
                if r:
                    return r
        return None

    def walk(node):
        if isinstance(node, list):
            for c in node:
                walk(c)
            return
        if not isinstance(node, dict):
            return
        lv = node.get("lockupViewModel")
        if isinstance(lv, dict):
            vid = lv.get("contentId")
            if isinstance(vid, str) and VIDEO_ID_RE.match(vid) and vid not in seen:
                seen.add(vid)
                out.append({"videoId": vid, "title": find_title(lv) or ""})
        pr = node.get("playlistVideoRenderer")
        if isinstance(pr, dict) and isinstance(pr.get("videoId"), str) and pr["videoId"] not in seen:
            seen.add(pr["videoId"])
            out.append({"videoId": pr["videoId"], "title": find_title(pr) or ""})
        for v in node.values():
            if isinstance(v, (dict, list)):
                walk(v)

    walk(payload)
    return out


def parse_html():
    try:
        with http(f"https://www.youtube.com/playlist?list={PLAYLIST_ID}&hl=ar") as res:
            html = res.read().decode("utf-8", "replace")
    except Exception as exc:
        print(f"html fetch failed: {exc}")
        return []
    out, seen = [], set()
    for block in html.split('"lockupViewModel"')[1:]:
        vid = re.search(r'"contentId":"([\w-]{11})"', block) or re.search(r"/watch\?v=([\w-]{11})", block)
        if not vid or vid.group(1) in seen:
            continue
        t = re.search(r'"title":\{"content":"((?:[^"\\]|\\.)*)"', block)
        title = t.group(1) if t else ""
        if title:
            try:
                title = json.loads(f'"{title}"')
            except Exception:
                title = title.replace("\\u0026", "&")
        seen.add(vid.group(1))
        out.append({"videoId": vid.group(1), "title": title})
    if out:
        return out
    for block in html.split('"playlistVideoRenderer"')[1:]:
        vid = re.search(r'"videoId":"([\w-]{11})"', block)
        t = re.search(r'"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"\}\]', block)
        if vid and vid.group(1) not in seen:
            seen.add(vid.group(1))
            title = t.group(1) if t else ""
            if title:
                try:
                    title = json.loads(f'"{title}"')
                except Exception:
                    title = title.replace("\\u0026", "&")
            out.append({"videoId": vid.group(1), "title": title})
    return out


def merge(*sources):
    out, seen = [], set()
    for src in sources:
        for row in src:
            vid = row.get("videoId")
            if not vid or not VIDEO_ID_RE.match(vid) or vid in seen:
                continue
            title = (row.get("title") or "").strip()
            if not title:
                continue
            seen.add(vid)
            out.append({"videoId": vid, "title": title})
    return out


def main():
    videos = merge(parse_innertube(), parse_html())
    videos = [
        v for v in videos
        if not any(marker in v["title"].lower() for marker in UNAVAILABLE_TITLES)
    ]
    print(f"parsed {len(videos)} videos from playlist {PLAYLIST_ID}")
    for i, v in enumerate(videos, 1):
        print(f"  {i}. {v['videoId']} | {v['title']}")

    if not videos:
        print("ERROR: zero videos parsed — relay aborts (never push an empty list)")
        sys.exit(2)

    if "--dry-run" in sys.argv:
        print("dry-run — not posting")
        return

    if len(SECRET) < 16:
        print("ERROR: SYNC_INGEST_SECRET missing/short")
        sys.exit(3)

    failed = False
    for start in range(0, len(videos), CHUNK_SIZE):
        chunk = videos[start:start + CHUNK_SIZE]
        body = json.dumps(
            {"videos": chunk, "source": "gh-actions"},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        ts = str(int(time.time() * 1000))
        sig = hmac.new(SECRET.encode(), body + b"." + ts.encode(), hashlib.sha256).hexdigest()
        try:
            with http(
                INGEST_URL,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "x-sync-signature": sig,
                    "x-sync-ts": ts,
                    # shield middleware requires the platform host on server-to-server calls
                    "x-forwarded-host": "ahmedelbaz.qzz.io",
                },
            ) as res:
                print(f"ingest status: {res.status} (videos {start + 1}-{start + len(chunk)})")
                print(res.read().decode()[:600])
        except Exception as exc:
            print(f"ERROR: ingest POST failed: {exc}")
            failed = True
    if failed:
        sys.exit(4)


if __name__ == "__main__":
    main()
