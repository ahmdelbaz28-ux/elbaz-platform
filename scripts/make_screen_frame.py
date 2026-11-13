"""Generate a synthetic 'engineering program' screenshot for the live
screen-reading chatbot E2E test. The frame mimics an ETAP-like single-line
diagram window with clearly readable electrical labels, so the bot's answer
can be objectively verified against what the image actually contains."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1000, 640
img = Image.new("RGB", (W, H), (238, 240, 243))
d = ImageDraw.Draw(img)

def font(size, bold=False):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

# window chrome
d.rectangle([0, 0, W, 44], fill=(45, 55, 72))
d.text((16, 12), "PowerFlow Studio  ETAP Mode  -  Project: Substation-A  (UNSAVED)", font=font(16, True), fill=(240, 240, 240))
d.rectangle([0, 44, W, 66], fill=(70, 80, 98))
d.text((16, 50), "File  Edit  View  Run  Study Case: LOAD-FLOW-1", font=font(14), fill=(210, 210, 215))

# canvas
d.rectangle([0, 66, W, H], fill=(250, 250, 252))

# grid bus (Bus-1)
d.rectangle([80, 160, 620, 176], fill=(30, 90, 200))
d.text((90, 182), "Bus-1   11.0 kV   400 A   PF 0.92", font=font(18, True), fill=(20, 40, 90))

# incoming feeder line + CB-1
d.line([(350, 66), (350, 160)], fill=(60, 60, 60), width=3)
d.rectangle([330, 92, 370, 132], outline=(200, 30, 30), width=3)
d.text((382, 100), "CB-1  630 A  CLOSED", font=font(16, True), fill=(140, 20, 20))

# transformer
d.circle((350, 200), 16, outline=(20, 60, 160), width=3)
d.circle((350, 222), 16, outline=(20, 60, 160), width=3)
d.line([(350, 176), (350, 184)], fill=(60, 60, 60), width=3)
d.line([(350, 238), (350, 260)], fill=(60, 60, 60), width=3)
d.text((380, 200), "TR-1  2.5 MVA  11/0.4 kV  Dyn11", font=font(16, True), fill=(20, 40, 90))

# load
d.rectangle([310, 300, 390, 350], fill=(30, 140, 90))
d.text((270, 356), "Load-1  400 kW  motor", font=font(16, True), fill=(20, 90, 60))
d.line([(350, 260), (350, 300)], fill=(60, 60, 60), width=3)

# status bar
d.rectangle([0, H - 34, W, H], fill=(45, 55, 72))
d.text((16, H - 26), "Alert: TR-1 loading 78%  |  Voltage drop 2.1%  |  Run: OK", font=font(14), fill=(255, 230, 120))

img.save("/home/z/my-project/elbaz-platform/scripts/screen-frame-e2e.png")
print("saved", img.size)
