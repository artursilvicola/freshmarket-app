"""
Fresh Market 2026 — '20th Edition of Fresh Market – Exhibitor Stories' series generator.

Generates LinkedIn/Facebook-ready graphics (1080x1350 vertical) with a fixed
editorial layout. Change 4 variables per graphic:
  - YEAR
  - COMPANY
  - TAGLINE
  - PHOTO_PATH

Usage:
  python3 fm_series_generator.py                 # generates demo for Mega Fresh 2008
  python3 fm_series_generator.py --batch data.csv  # reads a CSV and produces all

CSV columns:
  year,company,tagline,photo_path

Variant A = editorial / premium (default)
Variant B = social-media friendly (simpler, cleaner, higher contrast)
"""

import os
import sys
import csv
import math
import random
import argparse
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageEnhance

# ============================================================
# CONFIGURATION
# ============================================================

OUT_DIR = "/sessions/trusting-jolly-ramanujan/mnt/Fresh Market 2026/FM2026_Series"
os.makedirs(OUT_DIR, exist_ok=True)

# Canvas
W_PORTRAIT, H_PORTRAIT = 1080, 1350
W_SQUARE, H_SQUARE = 1080, 1080

# Palette
GREEN_DEEP    = (27, 58, 42)       # #1B3A2A — deep Fresh Market green (background base)
GREEN_RICH    = (31, 74, 52)       # #1F4A34 — richer accent on green
GREEN_LIGHT_OVERLAY = (24, 48, 34) # overlay green for gradient bottoms
CREAM         = (244, 235, 216)    # #F4EBD8 — cream banner
CREAM_SOFT    = (236, 225, 204)
GOLD          = (191, 158, 97)     # #BF9E61 — warm beige/gold separator
GOLD_LIGHT    = (212, 184, 130)
OFF_WHITE     = (248, 244, 234)    # #F8F4EA
INK           = (28, 40, 32)       # near-black green-tinted
MUTED         = (138, 152, 140)

# Fonts
FONT_LORA            = "/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf"
FONT_LORA_ITALIC     = "/usr/share/fonts/truetype/google-fonts/Lora-Italic-Variable.ttf"
FONT_POPPINS_MEDIUM  = "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf"
FONT_POPPINS_BOLD    = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_POPPINS_REGULAR = "/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf"

# Series title
SERIES_TITLE = "20TH EDITION OF FRESH MARKET  \u00B7  EXHIBITOR STORIES"


def F(path, size):
    return ImageFont.truetype(path, size)


# ============================================================
# HELPERS
# ============================================================

def add_grain(img, amount=14):
    """Add subtle monochrome grain for a paper/vintage feel."""
    w, h = img.size
    rnd = Image.effect_noise((w, h), amount)
    rnd = rnd.convert("L").filter(ImageFilter.GaussianBlur(0.3))
    overlay = Image.merge("RGB", (rnd, rnd, rnd))
    return Image.blend(img.convert("RGB"), overlay, 0.06)


def add_paper_texture(img):
    """Subtle paper-like tonal mottling."""
    w, h = img.size
    tex = Image.new("L", (w, h), 128)
    draw = ImageDraw.Draw(tex)
    rng = random.Random(42)
    for _ in range(900):
        x = rng.randint(0, w)
        y = rng.randint(0, h)
        r = rng.randint(40, 180)
        tone = 128 + rng.randint(-22, 22)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=tone)
    tex = tex.filter(ImageFilter.GaussianBlur(60))
    tex_rgb = Image.merge("RGB", (tex, tex, tex))
    return Image.blend(img, tex_rgb, 0.04)


def vignette(img, strength=0.55):
    """Apply a soft dark vignette."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for r in range(0, max(w, h), 4):
        alpha = int(strength * 255 * (r / max(w, h)))
        d.ellipse((-r, -r, w + r, h + r), outline=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(120))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(dark, img, mask)


def draw_text_center(draw, text, font, y, canvas_w, fill, spacing=0):
    """Draw horizontally-centered text at vertical y."""
    # Letter-spacing: render letter-by-letter if spacing>0
    if spacing == 0:
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(((canvas_w - tw) / 2 - bbox[0], y), text, font=font, fill=fill)
        return tw
    # With letter spacing
    widths = []
    for ch in text:
        b = draw.textbbox((0, 0), ch, font=font)
        widths.append((ch, b[2] - b[0], b[0]))
    total = sum(w for _, w, _ in widths) + spacing * (len(text) - 1)
    x = (canvas_w - total) / 2
    for ch, w, off in widths:
        draw.text((x - off, y), ch, font=font, fill=fill)
        x += w + spacing
    return total


def wrap_text(text, font, draw, max_width):
    """Wrap text to fit within max_width pixels; return list of lines."""
    words = text.split()
    if not words:
        return [""]
    lines, cur = [], words[0]
    for w in words[1:]:
        test = cur + " " + w
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            cur = test
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


# ============================================================
# BACKGROUND
# ============================================================

def make_background_portrait():
    """Deep-green textured background with subtle paper feel."""
    img = Image.new("RGB", (W_PORTRAIT, H_PORTRAIT), GREEN_DEEP)
    # Very subtle radial warmth in upper-mid
    glow = Image.new("RGB", (W_PORTRAIT, H_PORTRAIT), GREEN_RICH)
    mask = Image.new("L", (W_PORTRAIT, H_PORTRAIT), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((-300, -400, W_PORTRAIT + 300, 800), fill=120)
    mask = mask.filter(ImageFilter.GaussianBlur(200))
    img = Image.composite(glow, img, mask)
    img = add_paper_texture(img)
    img = add_grain(img, amount=10)
    return img


# ============================================================
# PHOTO PLACEHOLDER (when user hasn't provided real photo)
# ============================================================

def make_placeholder_photo(w, h, label="ARCHIVAL PHOTO PLACEHOLDER"):
    """Warm sepia gradient placeholder that evokes a vintage photograph."""
    img = Image.new("RGB", (w, h), (120, 95, 60))
    # Vertical gradient
    for y in range(h):
        t = y / h
        r = int(130 + 40 * (1 - t))
        g = int(110 + 15 * (1 - t))
        b = int(75 + 10 * (1 - t))
        ImageDraw.Draw(img).line([(0, y), (w, y)], fill=(r, g, b))
    # Soft vignette
    img = vignette(img, strength=0.4)
    img = add_grain(img, amount=22)
    # Label
    d = ImageDraw.Draw(img)
    try:
        f = F(FONT_POPPINS_MEDIUM, 22)
    except Exception:
        f = ImageFont.load_default()
    bbox = d.textbbox((0, 0), label, font=f)
    tw = bbox[2] - bbox[0]
    d.text(((w - tw) / 2, h / 2 - 14), label, font=f, fill=(240, 220, 190))
    d.text(((w - tw) / 2, h / 2 + 20),
           "(Replace layer 05_PHOTO_SMART_OBJECT with archival image)",
           font=F(FONT_POPPINS_REGULAR, 16), fill=(220, 200, 170))
    return img


# ============================================================
# PHOTO PROCESSING (gentle editorial grade, face-safe)
# ============================================================

def process_photo(img, target_w, target_h):
    """Conservative, face-safe processing: crop to target box, mild tone adjust."""
    img = img.convert("RGB")
    # Cover-fit crop
    src_ratio = img.width / img.height
    dst_ratio = target_w / target_h
    if src_ratio > dst_ratio:
        new_w = int(img.height * dst_ratio)
        left = (img.width - new_w) // 2
        img = img.crop((left, 0, left + new_w, img.height))
    else:
        new_h = int(img.width / dst_ratio)
        top = (img.height - new_h) // 2
        img = img.crop((0, top, img.width, top + new_h))
    img = img.resize((target_w, target_h), Image.LANCZOS)
    # Gentle tone: slight contrast + tiny warmth + mild saturation
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(0.92)
    img = ImageEnhance.Brightness(img).enhance(0.98)
    return img


# ============================================================
# TOP BANNER (cream, softly curved)
# ============================================================

def draw_top_banner(canvas, variant="A"):
    """Draw the cream top banner with series title. Softly curved bottom edge."""
    w, h = canvas.size
    banner_h = 120 if variant == "A" else 110

    # Banner rectangle with soft curve on bottom
    banner = Image.new("RGBA", (w, banner_h + 40), (0, 0, 0, 0))
    bd = ImageDraw.Draw(banner)
    # Cream fill
    bd.rectangle((0, 0, w, banner_h), fill=CREAM + (255,))
    # Curved bottom (subtle arch) - simulate with ellipse
    arch_r = 60
    bd.chord((0, banner_h - arch_r, w, banner_h + arch_r), 0, 180, fill=CREAM + (255,))
    # Fine grain on banner
    banner_rgb = banner.convert("RGB")
    banner_rgb = add_grain(banner_rgb, amount=6)
    # Compose back to RGBA using the alpha from original
    r, g, b = banner_rgb.split()
    a = banner.split()[3]
    banner = Image.merge("RGBA", (r, g, b, a))

    canvas.paste(banner, (0, 0), banner)

    # Gold hairline above the arch
    dd = ImageDraw.Draw(canvas)
    dd.line([(80, banner_h - 2), (w - 80, banner_h - 2)], fill=GOLD, width=2)

    # Series title text
    title_font_size = 26 if variant == "A" else 24
    title_font = F(FONT_LORA, title_font_size)
    # Letter-spacing uppercase treatment
    draw_text_center(
        ImageDraw.Draw(canvas),
        SERIES_TITLE,
        title_font,
        y=(banner_h - title_font_size) / 2 - 4,
        canvas_w=w,
        fill=INK,
        spacing=3,
    )


# ============================================================
# VARIANT A — EDITORIAL / PREMIUM (PORTRAIT 1080x1350)
# ============================================================

def render_variant_A(year, company, tagline, photo_path, out_path,
                     portrait=True):
    w, h = (W_PORTRAIT, H_PORTRAIT) if portrait else (W_SQUARE, H_SQUARE)
    canvas = make_background_portrait() if portrait else make_background_portrait().resize((w, h))
    canvas = canvas.convert("RGB")

    # 1. Top banner
    draw_top_banner(canvas, variant="A")
    draw = ImageDraw.Draw(canvas)

    # 2. Year (below banner, centered)
    year_y = 165 if portrait else 140
    year_font = F(FONT_LORA, 110 if portrait else 100)
    draw_text_center(draw, str(year), year_font, year_y, w, OFF_WHITE)

    # Gold separator below year
    sep_w = 120
    sep_y = year_y + (125 if portrait else 115)
    draw.line([((w - sep_w) / 2, sep_y), ((w + sep_w) / 2, sep_y)],
              fill=GOLD, width=2)

    # 3. Photo area (large central)
    margin_x = 80
    photo_x = margin_x
    photo_w = w - 2 * margin_x
    photo_y = sep_y + 40
    photo_h = int(photo_w * (0.72 if portrait else 0.62))

    # Load or placeholder
    if photo_path and os.path.exists(photo_path):
        photo_img = Image.open(photo_path)
        photo_img = process_photo(photo_img, photo_w, photo_h)
    else:
        photo_img = make_placeholder_photo(photo_w, photo_h)

    # Soft shadow
    shadow = Image.new("RGBA", (photo_w + 40, photo_h + 40), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((20, 20, photo_w + 20, photo_h + 20),
                         radius=6, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas.paste(shadow, (photo_x - 20, photo_y - 10), shadow)

    # Round corners on photo
    mask = Image.new("L", (photo_w, photo_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, photo_w, photo_h),
                                           radius=6, fill=255)
    canvas.paste(photo_img, (photo_x, photo_y), mask)

    # Thin gold hairline frame
    draw.rectangle((photo_x, photo_y, photo_x + photo_w, photo_y + photo_h),
                   outline=GOLD, width=1)

    # Bottom gradient overlay on photo lower half (for readability under photo)
    grad_h = int(photo_h * 0.38)
    grad = Image.new("RGBA", (photo_w, grad_h), (0, 0, 0, 0))
    for y in range(grad_h):
        a = int(180 * (y / grad_h) ** 1.4)
        ImageDraw.Draw(grad).line([(0, y), (photo_w, y)],
                                  fill=(GREEN_DEEP[0], GREEN_DEEP[1], GREEN_DEEP[2], a))
    canvas.paste(grad, (photo_x, photo_y + photo_h - grad_h), grad)

    # 4. Bottom text block (overlaid on lower part of photo + below)
    text_top_y = photo_y + photo_h - 150

    # Line 1 — Fresh Market {year}
    event_font = F(FONT_POPPINS_MEDIUM, 22)
    event_line = f"FRESH MARKET  {year}"
    draw_text_center(draw, event_line, event_font, text_top_y, w,
                     OFF_WHITE, spacing=4)

    # Gold dot separator
    cx, cy = w / 2, text_top_y + 40
    draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=GOLD)

    # Line 2 — Company name
    company_font = F(FONT_LORA, 56 if len(company) <= 14 else 44)
    draw_text_center(draw, company, company_font, text_top_y + 54, w, OFF_WHITE)

    # Line 3 — Tagline (italic, wrapped)
    tagline_font = F(FONT_LORA_ITALIC, 30)
    lines = wrap_text(tagline, tagline_font, draw, w - 2 * margin_x - 40)
    ly = text_top_y + 54 + (70 if len(company) <= 14 else 58)
    for line in lines:
        draw_text_center(draw, line, tagline_font, ly, w, CREAM_SOFT)
        ly += 36

    # Final vignette + grain
    canvas = vignette(canvas, strength=0.18)
    canvas = add_grain(canvas, amount=6)
    canvas.save(out_path, "PNG", optimize=True)
    return canvas


# ============================================================
# VARIANT B — SOCIAL-FRIENDLY (PORTRAIT 1080x1350)
# ============================================================

def render_variant_B(year, company, tagline, photo_path, out_path,
                     portrait=True):
    w, h = (W_PORTRAIT, H_PORTRAIT) if portrait else (W_SQUARE, H_SQUARE)
    canvas = make_background_portrait().resize((w, h)).convert("RGB")

    # Top banner (slightly simpler, straight bottom + gold line)
    banner_h = 96
    banner = Image.new("RGB", (w, banner_h), CREAM)
    canvas.paste(banner, (0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.line([(0, banner_h), (w, banner_h)], fill=GOLD, width=3)

    title_font = F(FONT_LORA, 24)
    draw_text_center(draw, SERIES_TITLE, title_font,
                     (banner_h - 24) / 2 - 2, w, INK, spacing=2)

    # Year — larger, simpler
    year_y = banner_h + 40
    year_font = F(FONT_LORA, 120)
    draw_text_center(draw, str(year), year_font, year_y, w, OFF_WHITE)

    # Photo — bigger, goes wider
    margin_x = 60
    photo_x = margin_x
    photo_w = w - 2 * margin_x
    photo_y = year_y + 145
    photo_h = int(photo_w * (0.82 if portrait else 0.66))

    if photo_path and os.path.exists(photo_path):
        photo_img = Image.open(photo_path)
        photo_img = process_photo(photo_img, photo_w, photo_h)
    else:
        photo_img = make_placeholder_photo(photo_w, photo_h)

    mask = Image.new("L", (photo_w, photo_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, photo_w, photo_h),
                                           radius=4, fill=255)
    canvas.paste(photo_img, (photo_x, photo_y), mask)
    draw.rectangle((photo_x, photo_y, photo_x + photo_w, photo_y + photo_h),
                   outline=GOLD, width=1)

    # Bottom block — dedicated solid area (no overlay gradient), cleaner
    block_y = photo_y + photo_h + 30

    # Event line
    event_font = F(FONT_POPPINS_BOLD, 22)
    draw_text_center(draw, f"FRESH MARKET  {year}", event_font, block_y, w,
                     GOLD_LIGHT, spacing=3)

    # Company name — punchier
    company_font = F(FONT_LORA, 60 if len(company) <= 14 else 48)
    draw_text_center(draw, company, company_font, block_y + 40, w, OFF_WHITE)

    # Tagline
    tagline_font = F(FONT_POPPINS_MEDIUM, 26)
    lines = wrap_text(tagline, tagline_font, draw, w - 2 * margin_x)
    ly = block_y + 40 + (75 if len(company) <= 14 else 65)
    for line in lines:
        draw_text_center(draw, line, tagline_font, ly, w, CREAM_SOFT)
        ly += 34

    canvas = vignette(canvas, strength=0.12)
    canvas = add_grain(canvas, amount=5)
    canvas.save(out_path, "PNG", optimize=True)
    return canvas


# ============================================================
# BATCH (CSV)
# ============================================================

def run_batch(csv_path, variant="A"):
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            out = os.path.join(
                OUT_DIR,
                f"FM2026_20th_{row['year']}_{row['company'].replace(' ', '')}_{variant}.png"
            )
            render = render_variant_A if variant == "A" else render_variant_B
            render(row["year"], row["company"], row["tagline"],
                   row.get("photo_path") or None, out)
            print("  ->", out)


# ============================================================
# MAIN — DEMO
# ============================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", help="CSV path for batch mode")
    parser.add_argument("--variant", choices=["A", "B"], default="A")
    args = parser.parse_args()

    if args.batch:
        run_batch(args.batch, args.variant)
        return

    # Demo: Mega Fresh 2008
    demo_cases = [
        ("2008", "Mega Fresh",
         "When vegetable production was still catching up"),
        ("2008", "Tajfun",
         "When packaged salads first arrived from Italy"),
        ("2012", "Agro-Paprix",
         "Building the first cross-border flower logistics"),
    ]

    for year, company, tagline in demo_cases:
        # Variant A, portrait
        out_a = os.path.join(OUT_DIR,
                             f"FM2026_20th_{year}_{company.replace(' ', '')}_A_1080x1350.png")
        render_variant_A(year, company, tagline, None, out_a, portrait=True)
        print("  A portrait ->", out_a)

        # Variant B, portrait
        out_b = os.path.join(OUT_DIR,
                             f"FM2026_20th_{year}_{company.replace(' ', '')}_B_1080x1350.png")
        render_variant_B(year, company, tagline, None, out_b, portrait=True)
        print("  B portrait ->", out_b)

    # Square export of the first case (variant A, 1080x1080)
    out_sq = os.path.join(OUT_DIR, "FM2026_20th_2008_MegaFresh_A_1080x1080.png")
    render_variant_A("2008", "Mega Fresh",
                     "When vegetable production was still catching up",
                     None, out_sq, portrait=False)
    print("  A square   ->", out_sq)


if __name__ == "__main__":
    main()
