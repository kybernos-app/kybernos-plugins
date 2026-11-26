#!/usr/bin/env python3
"""The picture of an audio example's card: the wave the dialog's player draws (the same slices of loudness and the same colour), on its gradient, already part-way played.

    python3 scripts/audio-poster.py <out.png> <hue 0-359> <peaks.json>      (peaks.json: a list of 16 to 128 numbers from 0 to 100)

1280x800, drawn at twice the size and brought down so the edges are smooth. Needs Pillow only. The play button is not drawn: the card puts its own over any picture.
"""
import colorsys, json, sys
from PIL import Image, ImageDraw

out, hue, peaks = sys.argv[1], float(sys.argv[2]), json.load(open(sys.argv[3]))
W, H, S = 1280, 800, 2


def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


a, b = hsl(hue, 0.52, 0.14), hsl(hue + 28, 0.56, 0.28)
# 140deg gradient: the position of a pixel along the diagonal decides its colour
img = Image.new('RGB', (W * S, H * S))
px = img.load()
for y in range(H * S):
    for x in range(0, W * S):
        t = (x / (W * S) * 0.64 + y / (H * S) * 0.77)
        t = max(0.0, min(1.0, t / 1.41))
        px[x, y] = (round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t), round(a[2] + (b[2] - a[2]) * t))
d = ImageDraw.Draw(img, 'RGBA')
n = len(peaks)
left, width = W * 0.06 * S, W * 0.88 * S
gap = 3 * S
bar = (width - gap * (n - 1)) / n
box = H * 0.44 * S
mid = H * 0.5 * S
played = round(n * 0.34)
on, off = hsl(hue, 0.96, 0.92), hsl(hue, 0.6, 0.9) + (77,)
for i, p in enumerate(peaks):
    h = box * max(7, p) / 100.0
    x0 = left + i * (bar + gap)
    d.rounded_rectangle([x0, mid - h / 2, x0 + bar, mid + h / 2], radius=bar / 2, fill=(on if i < played else off))
img.resize((W, H), Image.LANCZOS).save(out)
