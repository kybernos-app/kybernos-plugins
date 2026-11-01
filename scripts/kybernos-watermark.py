#!/usr/bin/env python3
"""The small animated « kybernos » mark that sits in the bottom right corner of a shelf video. It is drawn once, in code, from the same geometry as
kbBrandArt in packages/kybernos-plugin/client.js (nothing is read from a picture file): the red K (stem, arm, leg, and the three white dots of a chat that
is typing) and « ybernos » in lower case.

The play, once, then it stays:
  1. the whole mark comes in: the K, then the letters wiped out of it;
  2. the three dots bounce one after the other, then a soft light crosses the K;
  3. the letters are drawn back into the K, and the K slides to the corner;
  4. the K lands with a small pulse and stays still until the end of the film.

    python3 scripts/kybernos-watermark.py <out.mov> [--k-height 14] [--fps 24] [--delay 1.0] [--speed 1.0]

Out: a ProRes 4444 clip with alpha, DELAY seconds of nothing, then the play (SPEED 1.8 plays it 1.8 times faster, for a film of 5 seconds). The last picture is the K alone, at the right edge of the canvas: the composer
keeps showing it to the end of the film (overlay repeats the last frame), so the clip is NOT looped.
The canvas is the size of the whole mark; its right edge and bottom edge are PAD pixels away from the K, which the composer takes into account.
"""
import argparse, math, os, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RED = (242, 55, 42)
FONT = '/System/Library/Fonts/Avenir Next.ttc'     # index 5 is the Demi Bold face
SS = 4                                              # supersampling: drawn four times bigger, then shrunk
PAD_PX = 6                                          # transparent border, in output pixels (shadow, pulse)

# the play, in seconds after the delay
T_IN = (0.00, 0.40)           # the K comes in (fade + a small rise)
T_WIPE = (0.20, 0.85)         # the letters are wiped out of the K
T_DOTS = 1.00                 # the dots start to bounce (0.14 s apart)
T_SWEEP = (1.85, 2.65)        # the light crosses the K
T_OUT = (3.10, 3.75)          # the letters are drawn back into the K
T_SLIDE = (3.70, 4.35)        # the K glides to the corner
T_LAND = (4.35, 4.85)         # the K lands: a small pulse and one more bounce of the dots
T_END = 4.90

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--k-height', type=int, default=14)
ap.add_argument('--fps', type=int, default=24)
ap.add_argument('--delay', type=float, default=1.0)
ap.add_argument('--speed', type=float, default=1.0)
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
pad = PAD_PX * SS
W = pad + kw + gap + tw + pad
H = kh + 2 * pad
X0 = pad + kw + gap                                 # where the letters start
KX_FULL = pad                                       # the K at the left of the whole mark
KX_END = W - pad - kw                               # the K alone, at the right edge
SOFT = int(0.9 * kh)                                # the soft edge of the wipe


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def span(t, lo_hi):
    return ease((t - lo_hi[0]) / (lo_hi[1] - lo_hi[0]))


def k_mask():
    m = Image.new('L', (kw + 2 * pad, H), 0)
    d = ImageDraw.Draw(m)
    ox, oy = pad, pad
    P = lambda pts: [(ox + x * u, oy + y * u) for x, y in pts]
    d.rectangle([ox, oy, ox + 13 * u, oy + 36 * u], fill=255)
    d.polygon(P([(21, 0), (31, 0), (13, 28.3), (13, 12.6)]), fill=255)
    d.polygon(P([(13, 22), (22, 36), (32.5, 36), (20.3, 16.8), (13, 16.8)]), fill=255)
    return m


MASK = k_mask()
DOTS = [(6.5, 7.5), (6.5, 18.0), (6.5, 28.5)]


def soft_shadow(size, draw_fn):
    """A tight shadow, just enough to lift the mark off a bright picture without a dark halo."""
    layer = Image.new('L', size, 0)
    draw_fn(ImageDraw.Draw(layer), layer)
    layer = layer.filter(ImageFilter.GaussianBlur(1.0 * SS))
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    out.paste((0, 0, 0, 255), (int(0.4 * SS), int(0.8 * SS)), layer.point(lambda v: int(v * 0.42)))
    return out


def bump(t, start, dur=0.45):
    x = (t - start) / dur
    return math.sin(math.pi * x) if 0 <= x <= 1 else 0.0


def k_sprite(t):
    """The K alone, with its light and its dots, on a canvas of its own (kw + 2 pad wide)."""
    w = kw + 2 * pad
    img = soft_shadow((w, H), lambda d, layer: d.bitmap((0, 0), MASK, fill=255))
    sweep = (t - T_SWEEP[0]) / (T_SWEEP[1] - T_SWEEP[0])
    glow = ease(1 - abs(sweep * 2 - 1)) if 0 <= sweep <= 1 else 0.0
    base = tuple(min(255, int(c + (255 - c) * 0.18 * glow)) for c in RED)
    img.paste(Image.new('RGBA', (w, H), base + (255,)), (0, 0), MASK)
    if 0 <= sweep <= 1:
        band = Image.new('L', (w, H), 0)
        cx = -0.25 * kw + sweep * (kw * 1.5 + 0.5 * kh)
        bw = 0.34 * kw
        ImageDraw.Draw(band).polygon([(pad + cx - bw, pad + kh), (pad + cx, pad + kh), (pad + cx + 0.45 * kh, pad), (pad + cx + 0.45 * kh - bw, pad)], fill=235)
        band = band.filter(ImageFilter.GaussianBlur(0.08 * kw))
        clipped = Image.composite(band, Image.new('L', (w, H), 0), MASK)
        img.paste(Image.new('RGBA', (w, H), (255, 255, 255, 255)), (0, 0), clipped.point(lambda v: int(v * 0.85)))
    d = ImageDraw.Draw(img)
    for i, (cx, cy) in enumerate(DOTS):
        b = max(bump(t, T_DOTS + i * 0.14), bump(t, T_LAND[0] + 0.05 + i * 0.1, 0.4))
        r = (2.8 + 1.5 * b) * u
        lift = -2.2 * b * u
        d.ellipse([pad + cx * u - r, pad + cy * u + lift - r, pad + cx * u + r, pad + cy * u + lift + r], fill=(255, 255, 255, 255))
    return img


def letters_layer():
    """The letters with their shadow, where they sit in the whole mark."""
    def draw(d, layer):
        d.text((X0, pad + kh), text, font=font, fill=255, anchor='ls')
    img = soft_shadow((W, H), draw)
    ImageDraw.Draw(img).text((X0, pad + kh), text, font=font, fill=(255, 255, 255, 255), anchor='ls')
    return img


LETTERS = letters_layer()


def letters_edge(t):
    """Right edge of what is visible of the letters: it grows with the wipe, then shrinks back into the K."""
    lo, hi = X0 - SOFT, X0 + tw + SOFT
    return lo + (hi - lo) * span(t, T_WIPE) - (hi - lo) * span(t, T_OUT)


def frame(t):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    appear = span(t, T_IN)
    # the letters, wiped in and drawn back out (left of the edge is visible, with a soft edge)
    edge = letters_edge(t)
    if 0 < edge - (X0 - SOFT) and appear > 0:
        mask = Image.new('L', (W, H), 0)
        md = ImageDraw.Draw(mask)
        md.rectangle([0, 0, max(0, int(edge - SOFT)), H], fill=255)
        for i in range(SOFT):
            x = int(edge - SOFT + i)
            if 0 <= x < W:
                md.line([(x, 0), (x, H)], fill=int(255 * (1 - i / SOFT)))
        slide = -0.1 * kh * span(t, T_OUT)               # the letters also lean toward the K as they go
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        layer.paste(LETTERS, (int(slide), 0))
        a = layer.getchannel('A')
        layer.putalpha(Image.composite(a, Image.new('L', (W, H), 0), mask).point(lambda v: int(v * appear)))
        img = Image.alpha_composite(img, layer)
    # the K: comes in at the left, glides to the right edge once the letters are gone, lands with a pulse
    s = k_sprite(t)
    glide = span(t, T_SLIDE)
    kx = KX_FULL + (KX_END - KX_FULL) * glide
    pulse = 1.0 + 0.14 * bump(t, T_LAND[0], T_LAND[1] - T_LAND[0])
    rise = (1 - appear) * 0.25 * kh
    if pulse != 1.0:
        sw, sh = s.size
        s = s.resize((int(sw * pulse), int(sh * pulse)), Image.LANCZOS)
        ox, oy = (s.size[0] - sw) // 2, (s.size[1] - sh) // 2
    else:
        ox = oy = 0
    s.putalpha(s.getchannel('A').point(lambda v: int(v * appear)))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(s, (int(round(kx - pad)) - ox, int(round(rise)) - oy), s)
    img = Image.alpha_composite(img, layer)
    return img.resize((W // SS, H // SS), Image.LANCZOS)


tmp = tempfile.mkdtemp(prefix='kbwm-')
try:
    n_delay = int(round(a.delay * a.fps))
    n_play = int(round(T_END / a.speed * a.fps))
    blank = Image.new('RGBA', (W // SS, H // SS), (0, 0, 0, 0))
    for i in range(n_delay):
        blank.save(os.path.join(tmp, 'f%04d.png' % i))
    last = None
    for i in range(n_play):
        last = frame(i / a.fps * a.speed)
        last.save(os.path.join(tmp, 'f%04d.png' % (n_delay + i)))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(a.fps), '-i', os.path.join(tmp, 'f%04d.png'),
                    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', os.path.abspath(a.out)], check=True)
    print('%s: %dx%d, %d frames, pad %d' % (a.out, W // SS, H // SS, n_delay + n_play, PAD_PX))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
