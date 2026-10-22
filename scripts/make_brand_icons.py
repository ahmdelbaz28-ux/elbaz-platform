"""Generate the full brand icon set from public/logo-circle.png (Task 20).

Everything downstream of the circular logo so the brand is unified all the
way to the browser tab and the boot splash (owner request).

Outputs (all in public/, committed):
  favicon-16x16.png   transparent circle
  favicon-32x32.png   transparent circle
  favicon.ico         16/32/48 multi-size, transparent
  apple-touch-icon.png (180)  circle composited on brand dark bg (iOS no alpha)
  pwa-192x192.png / pwa-512x512.png  circle on dark bg, 80% safe zone (maskable)
  logo-splash.png     (192) light transparent circle for the boot splash

Print version (NOT committed — saved to /home/z/my-project/download/):
  logo-circle-print-2048.png  2048x2048 LANCZOS upscale + unsharp mask

Re-run any time:  python3 scripts/make_brand_icons.py
"""
from PIL import Image, ImageFilter
import os

ROOT = "/home/z/my-project/work/elbaz-platform"
SRC = f"{ROOT}/public/logo-circle.png"
PUB = f"{ROOT}/public"
DL = "/home/z/my-project/download"
BRAND_BG = (10, 14, 23, 255)  # #0a0e17 — the site's dark background

os.makedirs(DL, exist_ok=True)
logo = Image.open(SRC).convert("RGBA")
print(f"source: {logo.size[0]}x{logo.size[1]}")


def fit(size: int) -> Image.Image:
    return logo.resize((size, size), Image.LANCZOS)


def on_dark(size: int, ratio: float) -> Image.Image:
    """Circle composited on the brand dark square (iOS/PWA want no alpha)."""
    canvas = Image.new("RGBA", (size, size), BRAND_BG)
    inner = int(size * ratio)
    art = fit(inner)
    off = (size - inner) // 2
    canvas.alpha_composite(art, (off, off))
    return canvas


# ── Favicons (transparent circle) ──────────────────────────────────────────
fit(32).save(f"{PUB}/favicon-32x32.png", optimize=True)
fit(16).save(f"{PUB}/favicon-16x16.png", optimize=True)

master = fit(64)  # ICO frames downscale best from a small master
master.save(f"{PUB}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)],
            append_images=[fit(32), fit(48)])

# ── Apple touch + PWA icons (dark background, safe-zone padding) ───────────
on_dark(180, 0.82).save(f"{PUB}/apple-touch-icon.png", optimize=True)
on_dark(192, 0.80).save(f"{PUB}/pwa-192x192.png", optimize=True)
on_dark(512, 0.80).save(f"{PUB}/pwa-512x512.png", optimize=True)

# ── Boot splash (transparent, small, fast first paint) ─────────────────────
splash = fit(192)
splash.save(f"{PUB}/logo-splash.png", optimize=True)

# ── Print version (high-res deliverable for the owner, not committed) ──────
big = logo.resize((2048, 2048), Image.LANCZOS).filter(
    ImageFilter.UnsharpMask(radius=2.2, percent=110, threshold=2)
)
print_path = f"{DL}/logo-circle-print-2048.png"
big.save(print_path, optimize=True)

for f in ["favicon-16x16.png", "favicon-32x32.png", "favicon.ico",
          "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png",
          "logo-splash.png"]:
    p = f"{PUB}/{f}"
    print(f"{f:24s} {os.path.getsize(p):>9,} B")
print(f"{'logo-circle-print-2048.png':24s} {os.path.getsize(print_path):>9,} B  -> {print_path}")
print("done")
