#!/usr/bin/env python3
"""The small animated « kybernos » mark that sits at the bottom of a shelf video: the red K (stem, arm, leg, and the three white dots of a chat that is typing)
followed by « ybernos » in lower case. Drawn in code from the same geometry as kbBrandArt in packages/kybernos-plugin/client.js (nothing is read from a
picture file). Every PERIOD seconds the three dots bounce one after the other, then a soft light sweeps across the K.

    python3 scripts/kybernos-watermark.py <out.mov> [--k-height 26] [--period 4.0] [--fps 24]

Out: a ProRes 4444 clip with alpha (PERIOD seconds, to be looped over the video by scripts/video-compose.mjs).
"""
import argparse, math, os, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RED = (242, 55, 42)
FONT = '/System/Library/Fonts/Avenir Next.ttc'     # index 5 is the Demi Bold face
SS = 4                                              # supersampling: drawn four times bigger, then shrunk

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--k-height', type=int, default=26)
ap.add_argument('--period', type=float, default=4.0)
ap.add_argument('--fps', type=int, default=24)
a = ap.parse_args()

kh = a.k_height * SS
u = kh / 36.0                                       # one unit of the K's own grid (32.5 x 36)
font_px = int(round(kh / 0.93))                     # the wordmark rule: the K is .93 of the font size
try:
    font = ImageFont.truetype(FONT, font_px, index=5)
except Exception:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', font_px)
text = 'ybernos'
tw = int(font.getlength(text))
kw = int(round(32.5 * u))
gap = int(round(0.075 * font_px))
pad = int(round(6 * SS))
W = kw + gap + tw + 2 * pad
H = kh + 2 * pad


def k_mask():
    m = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(m)
    ox, oy = pad, pad
    P = lambda pts: [(ox + x * u, oy + y * u) for x, y in pts]
    d.rectangle([ox, oy, ox + 13 * u, oy + 36 * u], fill=255)
    d.polygon(P([(21, 0), (31, 0), (13, 28.3), (13, 12.6)]), fill=255)
    d.polygon(P([(13, 22), (22, 36), (32.5, 36), (20.3, 16.8), (13, 16.8)]), fill=255)
    return m


MASK = k_mask()
DOTS = [(6.5, 7.5), (6.5, 18.0), (6.5, 28.5)]


def ease(x):
    return x * x * (3 - 2 * x)


def frame(t):
    """One frame of the loop, at t seconds (0 <= t < period)."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # soft shadow under everything, so the mark reads on a bright picture too
    shadow = Image.new('L', (W, H), 0)
    sd = ImageDraw.Draw(shadow)
    sd.bitmap((0, 0), MASK, fill=120)
    sd.text((pad + kw + gap, pad + kh), text, font=font, fill=120, anchor='ls')
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.2 * SS))
    img.paste((0, 0, 0, 255), (SS, int(1.2 * SS)), shadow)
    # a gentle swell of the K while the light crosses it
    sweep = (t - 1.3) / 0.9
    glow = ease(max(0.0, min(1.0, 1 - abs(sweep * 2 - 1)))) if 0 <= sweep <= 1 else 0.0
    base = tuple(min(255, int(c + (255 - c) * 0.18 * glow)) for c in RED)
    img.paste(Image.new('RGBA', (W, H), base + (255,)), (0, 0), MASK)
    # the sweep: a slanted band of light, clipped to the K
    if 0 <= sweep <= 1:
        band = Image.new('L', (W, H), 0)
        bd = ImageDraw.Draw(band)
        cx = -0.25 * kw + sweep * (kw * 1.5 + 0.5 * kh)
        w = 0.34 * kw
        bd.polygon([(pad + cx - w, pad + kh), (pad + cx, pad + kh), (pad + cx + 0.45 * kh, pad), (pad + cx + 0.45 * kh - w, pad)], fill=235)
        band = band.filter(ImageFilter.GaussianBlur(0.08 * kw))
        clipped = Image.composite(band, Image.new('L', (W, H), 0), MASK)
        img.paste(Image.new('RGBA', (W, H), (255, 255, 255, 255)), (0, 0), clipped.point(lambda v: int(v * 0.85)))
    # the three typing dots bounce one after the other, near the start of the loop
    d = ImageDraw.Draw(img)
    for i, (cx, cy) in enumerate(DOTS):
        x = (t - 0.15 - i * 0.14) / 0.45
        bump = math.sin(math.pi * x) if 0 <= x <= 1 else 0.0
        r = (2.8 + 1.5 * bump) * u
        lift = -2.2 * bump * u
        d.ellipse([pad + cx * u - r, pad + (cy + 0) * u + lift - r, pad + cx * u + r, pad + cy * u + lift + r], fill=(255, 255, 255, 255))
    # the letters
    d.text((pad + kw + gap, pad + kh), text, font=font, fill=(255, 255, 255, 235), anchor='ls')
    return img.resize((W // SS, H // SS), Image.LANCZOS)


tmp = tempfile.mkdtemp(prefix='kbwm-')
try:
    n = int(round(a.period * a.fps))
    for i in range(n):
        frame(i / a.fps).save(os.path.join(tmp, 'f%04d.png' % i))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(a.fps), '-i', os.path.join(tmp, 'f%04d.png'),
                    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', os.path.abspath(a.out)], check=True)
    print('%s: %dx%d, %d frames' % (a.out, W // SS, H // SS, n))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
