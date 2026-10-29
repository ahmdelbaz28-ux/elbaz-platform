"""Live production verification of the SLD busbar-attachment root fix.

Sends the EXACT user-rejected scenario (motor + lighting fed from one busbar)
to the production diagram endpoint and asserts the wire-routing contract on
the returned SVG:
  1. every wire endpoint that sits at a busbar edge Y is INSIDE the bar span
     (never past the rounded ends) — 'cables not attached to the bus'
  2. dots on the same bar edge are >= 20px apart — 'cables bunched together'
  3. no two horizontal runs share a lane — 'overlapping lines'
Polls until the new build is live or the timeout expires.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://ahmedelbaz.qzz.io"

LIVE_SPEC = {
    "title": "منشأة صناعية - بار موزعة بمحرك وإنارة",
    "elements": [
        {"id": "G1", "type": "grid", "x": 1, "y": 0, "label": "الشبكة العامة 66kV"},
        {"id": "GEN", "type": "generator", "x": 4, "y": 0, "label": "مولد احتياطي"},
        {"id": "CB1", "type": "breaker", "x": 1, "y": 1},
        {"id": "CB2", "type": "breaker", "x": 4, "y": 1},
        {"id": "B1", "type": "busbar", "x": 1, "y": 2, "len": 3, "label": "بار 11kV"},
        {"id": "M1", "type": "motor", "x": 1, "y": 3, "label": "محرك 500kW"},
        {"id": "L1", "type": "load", "x": 3, "y": 3, "label": "إنارة 150kVA"},
    ],
    "connections": [
        ["G1", "CB1"],
        ["CB1", "B1"],
        ["GEN", "CB2"],
        ["CB2", "B1"],
        ["B1", "M1"],
        ["B1", "L1"],
    ],
    "theme": "dark",
}

RE_POLY = re.compile(r'<polyline points="([^"]+)"')
RE_BAR = re.compile(r'<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="10"')
RE_DOT = re.compile(r'<circle cx="([-\d.]+)" cy="([-\d.]+)" r="3"')


def fetch_svg(spec: dict) -> str:
    url = f"{BASE}/api/diagrams/sld?spec={urllib.parse.quote(json.dumps(spec, ensure_ascii=False))}&v=qa-fix"
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "sld-qa/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def audit(svg: str) -> dict:
    polys = [
        [(float(a), float(b)) for a, b in (pt.split(",") for pt in m.group(1).split())]
        for m in RE_POLY.finditer(svg)
    ]
    bars = [(float(m.group(1)), float(m.group(2)), float(m.group(1)) + float(m.group(3)), float(m.group(2)) + 10) for m in RE_BAR.finditer(svg)]
    dots = [(float(m.group(1)), float(m.group(2))) for m in RE_DOT.finditer(svg)]

    report = {"bars": len(bars), "wires": len(polys), "dots": len(dots), "fail": []}

    # 1) attachment: endpoints at a bar edge Y must be inside the bar span
    for x1, y1, x2, y2 in bars:
        for poly in polys:
            for px, py in (poly[0], poly[-1]):
                if abs(py - y1) < 0.5 or abs(py - y2) < 0.5:
                    if not (x1 + 4 <= px <= x2 - 4):
                        report["fail"].append(f"endpoint {px},{py} outside bar [{x1},{x2}] (unattached)")

    # 2) separation: dots on the same edge >= 20px apart
    for x1, y1, x2, y2 in bars:
        for edge in (y1, y2):
            xs = sorted(dx for dx, dy in dots if abs(dy - edge) < 0.5)
            for a, b in zip(xs, xs[1:]):
                if b - a < 20:
                    report["fail"].append(f"dots {a},{b} bunched ({b - a:.0f}px) on one edge")

    # 3) lanes: no two horizontal runs from different wires share/touch a Y
    hsegs = []
    for wi, poly in enumerate(polys):
        for (ax, ay), (bx, by) in zip(poly, poly[1:]):
            if ay == by:
                hsegs.append((wi, ay, min(ax, bx), max(ax, bx)))
    for i in range(len(hsegs)):
        for j in range(i + 1, len(hsegs)):
            wi, ay, ax1, ax2 = hsegs[i]
            wj, by, bx1, bx2 = hsegs[j]
            if wi == wj or abs(ay - by) >= 7:
                continue
            if max(ax1, bx1) - 2 <= min(ax2, bx2) + 2:
                report["fail"].append(f"horizontal overlap wires {wi}/{wj} at y={ay}")

    report["ok"] = not report["fail"]
    return report


def main():
    deadline = time.time() + 420  # up to 7 min for the deploy
    attempt = 0
    while True:
        attempt += 1
        try:
            svg = fetch_svg(LIVE_SPEC)
            rep = audit(svg)
            print(f"[{attempt}] prod: bars={rep['bars']} wires={rep['wires']} dots={rep['dots']} ok={rep['ok']}")
            if rep["fail"]:
                for f in rep["fail"]:
                    print("  FAIL:", f)
            import os
            os.makedirs("/home/z/my-project/work/download/sld-qa", exist_ok=True)
            with open("/home/z/my-project/work/download/sld-qa/prod-live.svg", "w") as fh:
                fh.write(svg)
            if rep["ok"]:
                print("PASS — production renders the rejected scenario correctly")
                return 0
            if attempt >= 3 and time.time() > deadline - 300:
                pass
        except Exception as exc:  # noqa: BLE001
            print(f"[{attempt}] endpoint error: {exc}")
        if time.time() > deadline:
            print("TIMEOUT — could not confirm the fix live within 7 minutes")
            return 1
        time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())
