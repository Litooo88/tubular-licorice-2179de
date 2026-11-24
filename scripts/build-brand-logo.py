"""Bygger sajtens logotypfiler från originalet docs/brand/logo-original-824.png.

  brand/logo.webp      400x400  header/footer på alla publika sidor
  brand/logo-1200.png  1200x1200 Google Ads / Organization-schema

Originalet är 824x817 px (ingen vektorfil finns). logo-1200 skalar emblemet
ca 18 % uppåt så att det fyller en cirkelbeskärning med 1/16 marginal.

Kör: python scripts/build-brand-logo.py   (kräver Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "brand" / "logo-original-824.png"
OUT = ROOT / "brand"
BG = (10, 10, 8)
EMBLEM = (130, 67, 666, 777)  # emblemets ytterkant i originalet


def site_logo(src):
    cx = (EMBLEM[0] + EMBLEM[2]) / 2
    cy = (EMBLEM[1] + EMBLEM[3]) / 2
    side = round((EMBLEM[3] - EMBLEM[1]) * 1.10)
    left = round(cx - side / 2)
    top = round(cy - side / 2)
    tile = Image.new("RGB", (side, side), BG)
    tile.paste(src, (-left, -top))
    return tile.resize((400, 400), Image.LANCZOS)


def ads_logo(src):
    size, margin = 1200, 1200 // 16
    w = EMBLEM[2] - EMBLEM[0]
    h = EMBLEM[3] - EMBLEM[1]
    scale = (size - 2 * margin) / (w * w + h * h) ** 0.5
    pad = 24
    crop = src.crop((EMBLEM[0] - pad, EMBLEM[1] - pad, EMBLEM[2] + pad, EMBLEM[3] + pad))
    crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
    # Mjuk kant så att originalets brusiga bakgrund inte ger en synlig skarv.
    feather = round(pad * scale * 0.8)
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).rectangle((feather, feather, crop.width - feather, crop.height - feather), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    canvas = Image.new("RGB", (size, size), BG)
    canvas.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2), mask)
    return canvas


def main():
    src = Image.open(SRC).convert("RGB")
    OUT.mkdir(exist_ok=True)
    site_logo(src).save(OUT / "logo.webp", quality=88, method=6)
    ads_logo(src).save(OUT / "logo-1200.png", optimize=True)
    for name in ("logo.webp", "logo-1200.png"):
        f = OUT / name
        print(name, Image.open(f).size, f"{f.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
