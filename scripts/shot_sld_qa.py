"""Screenshot SLD QA SVGs in real Chromium (ground truth for <img> rendering —
cairosvg ignores direction=rtl and lies about label placement)."""
import asyncio
import glob
import os

from playwright.async_api import async_playwright

BASE = "/home/z/my-project/work/download/sld-qa"


async def main():
    files = sorted(glob.glob(f"{BASE}/*.svg"))
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox", "--force-color-profile=srgb"])
        page = await browser.new_page(viewport={"width": 900, "height": 700}, device_scale_factor=2)
        for f in files:
            name = os.path.basename(f).replace(".svg", "")
            html = f"""<!doctype html><html><body style="margin:0;background:#0b1622;display:grid;place-items:center;width:900px;height:700px;">
<img src="file://{f}" style="max-width:860px;max-height:660px"/></body></html>"""
            tmp = f"{BASE}/{name}.html"
            with open(tmp, "w") as fh:
                fh.write(html)
            await page.goto(f"file://{tmp}")
            await page.wait_for_timeout(250)
            await page.screenshot(path=f"{BASE}/{name}-browser.png")
            os.remove(tmp)
            print("shot", name)
        await browser.close()


asyncio.run(main())
