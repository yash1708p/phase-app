"""Generate Phase PWA icons (run: python3 scripts/generate-icons.py).

Draws a half-filled ring — a moon-phase motif — on a blush background.
Maskable icon keeps the mark inside the 80% safe zone.
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BG, ROSE, CREAM = (249, 217, 215), (224, 122, 127), (255, 248, 242)

def draw(size: int, scale: float, rounded: bool) -> Image.Image:
    ss = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, ss, ss], radius=int(ss * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, ss, ss], fill=BG)
    c, r = ss / 2, ss * 0.27 * scale
    w = max(4, int(ss * 0.075 * scale))
    d.ellipse([c - r, c - r, c + r, c + r], fill=CREAM)
    d.pieslice([c - r, c - r, c + r, c + r], start=-90, end=90, fill=ROSE)
    d.ellipse([c - r, c - r, c + r, c + r], outline=ROSE, width=w)
    return img.resize((size, size), Image.LANCZOS)

draw(192, 1.0, True).save(OUT / "icon-192.png")
draw(512, 1.0, True).save(OUT / "icon-512.png")
draw(512, 0.78, False).save(OUT / "maskable-512.png")
draw(180, 1.0, False).convert("RGB").save(OUT / "apple-touch-icon.png")
print("icons written to", OUT)
