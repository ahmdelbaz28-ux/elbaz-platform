"""Generate public/logo-circle.png — the circular AE logo cropped edge-to-edge
from public/logo.jpg (which sits on a white rectangle background).

The output is a square transparent PNG whose non-transparent region is exactly
the logo's own circular outline (anti-aliased mask, 4x supersampled), so the
circle edge IS the logo edge — no white rectangle, no padding, no additions.
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = "/home/z/my-project/work/elbaz-platform/public/logo.jpg"
OUT = "/home/z/my-project/work/elbaz-platform/public/logo-circle.png"

img = Image.open(SRC).convert("RGBA")
W, H = img.size
print(f"source: {W}x{H}")

# ── 1. Locate the logo's outer circle ──────────────────────────────────────
# Non-white mask (threshold 245 catches the dark navy ring + light accents).
gray = img.convert("L")
bw = gray.point(lambda v: 255 if v < 245 else 0)
bbox = bw.getbbox()
print(f"non-white bbox: {bbox}")
x0, y0, x1, y1 = bbox
bw_w, bw_h = x1 - x0, y1 - y0
print(f"bbox size: {bw_w}x{bw_h}  (aspect {bw_w / bw_h:.3f})")

# The outer ring should be the outermost artwork → bbox ~square.
# Use the larger dimension as the circle diameter so nothing is clipped.
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
d = max(bw_w, bw_h)
# If the bbox is wider than tall (elements poking sideways), still fit: the
# circle must cover the ring; panels inside the ring stay inside.
r = d / 2

# ── 2. Crop a square centered on the circle ────────────────────────────────
half = int(r) + 2  # 2px safety so the anti-aliased ring edge isn't shaved
sq = img.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
side = sq.size[0]
print(f"crop: {side}x{side} centered ({cx:.0f},{cy:.0f})")

# ── 3. Circular alpha mask — edges exactly at the logo ring ────────────────
# Supersample 4x for a smooth anti-aliased edge, then downscale.
S = side * 4
mask = Image.new("L", (S, S), 0)
draw = ImageDraw.Draw(mask)
# mask radius: cover the full ring (diameter d) — draw at 4x scale
mr = (d / 2) * 4 - 4  # -4 (1px at 1x) keeps the ring's own AA edge intact
mhalf = half * 4
draw.ellipse((mhalf - mr, mhalf - mr, mhalf + mr, mhalf + mr), fill=255)
mask = mask.resize((side, side), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))

empty = Image.new("RGBA", (side, side), (0, 0, 0, 0))
out = Image.composite(sq, empty, mask)

# ── 4. Trim fully-transparent margins (edge == circle edge) ────────────────
alpha = out.getchannel("A")
ab = alpha.getbbox()
out = out.crop(ab)
print(f"final: {out.size[0]}x{out.size[1]}")

out.save(OUT, optimize=True)
print(f"saved → {OUT}")
