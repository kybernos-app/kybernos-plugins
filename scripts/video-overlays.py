#!/usr/bin/env python3
"""Small designed overlays for a composed film, drawn in code (no picture file): a mini floor plan that follows the visit, and a legend of the features.

    python3 scripts/video-overlays.py <spec.json> <out.mov>

The spec names the overlay (`kind`: "minimap" or "legend"), its size and timing. Out: a ProRes 4444 clip with alpha (`delay` seconds of nothing, then the play); the
last picture stays on screen until the end of the film (overlay repeats it), so a spec ends with `fadeOutAt` when it must go. scripts/video-compose.mjs puts it
where the recipe says (`overlays`: file, anchor, dx, dy).

minimap: { "kind": "minimap", "width": 250, "fps": 24, "delay": 1.2, "duration": 25.0, "fadeOutAt": 24.4, "title": "FLOOR PLAN",
           "rooms": [ { "id": "living", "label": "Living room", "x": 44, "y": 20, "w": 48, "h": 40, "kind": "room" } ... ],   kind: room | wet (a bathroom) | outdoor | pool | dim (a room not visited)
           "route": [ { "at": 0.0, "id": "exterior", "label": "Arrival", "dot": [68, 76] }, { "at": 4.5, "id": "living" } ... ] }       a dot glides to the room named at `at` (a time of the FILM)
legend:  { "kind": "legend", "width": 214, "fps": 24, "delay": 2.6, "duration": 25.0, "fadeOutAt": 24.4, "title": "THE HOUSE",
           "items": [ { "icon": "bed", "text": "5 bedrooms" }, { "icon": "bath", "text": "4 bathrooms" }, { "icon": "area", "text": "420 m²" },
                      { "icon": "pool", "text": "Infinity pool" }, { "icon": "sea", "text": "Sea view" } ] }       icons: bed, bath, area, pool, sea, key, leaf, sun
"""
import json, math, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = '/System/Library/Fonts/Avenir Next.ttc'     # 5 = Demi Bold, 7 = Medium, 0 = Regular
SS = 3
ACCENT = (242, 55, 42)
WHITE = (255, 255, 255)


def font(px, index=5):
    try:
        return ImageFont.truetype(FONT, int(px), index=index)
    except Exception:
        return ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', int(px))


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def card(w, h, radius):
    """A dark glass card with a thin light edge and a soft shadow, on a transparent canvas bigger by the shadow's margin."""
    m = 10 * SS
    img = Image.new('RGBA', (w + 2 * m, h + 2 * m), (0, 0, 0, 0))
    sh = Image.new('L', img.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle([m, m + 2 * SS, m + w, m + h + 2 * SS], radius, fill=140)
    sh = sh.filter(ImageFilter.GaussianBlur(5 * SS))
    img.paste((0, 0, 0, 255), (0, 0), sh)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([m, m, m + w, m + h], radius, fill=(14, 16, 22, 178), outline=(255, 255, 255, 70), width=max(1, SS // 2))
    return img, m


def icon(d, name, cx, cy, s, col):
    """Simple line icons on a grid of size s (a square centred on cx, cy)."""
    w = max(2, int(s * 0.09))
    x0, y0, x1, y1 = cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2
    if name == 'bed':
        d.line([(x0, y0 + s * .2), (x0, y1 - s * .15)], fill=col, width=w)
        d.line([(x0, y1 - s * .3), (x1, y1 - s * .3)], fill=col, width=w)
        d.line([(x1, y1 - s * .3), (x1, y1 - s * .15)], fill=col, width=w)
        d.rounded_rectangle([x0 + s * .12, y0 + s * .32, x0 + s * .42, y0 + s * .52], s * .06, outline=col, width=w)
        d.line([(x0 + s * .5, y1 - s * .3), (x0 + s * .5, y0 + s * .45), (x1, y0 + s * .45), (x1, y1 - s * .3)], fill=col, width=w, joint='curve')
    elif name == 'bath':
        d.line([(x0, y0 + s * .5), (x1, y0 + s * .5)], fill=col, width=w)
        d.arc([x0, y0 + s * .1, x1, y1 + s * .35], 0, 180, fill=col, width=w)
        d.line([(x0 + s * .15, y1 - s * .02), (x0 + s * .1, y1 + s * .12)], fill=col, width=w)
        d.line([(x1 - s * .15, y1 - s * .02), (x1 - s * .1, y1 + s * .12)], fill=col, width=w)
        d.arc([x0 + s * .08, y0 - s * .1, x0 + s * .48, y0 + s * .4], 180, 300, fill=col, width=w)
    elif name == 'area':
        d.rectangle([x0 + s * .12, y0 + s * .12, x1 - s * .12, y1 - s * .12], outline=col, width=w)
        for (ax, ay, bx, by) in [(x0, y0, x0 + s * .3, y0), (x0, y0, x0, y0 + s * .3), (x1, y1, x1 - s * .3, y1), (x1, y1, x1, y1 - s * .3)]:
            d.line([(ax, ay), (bx, by)], fill=col, width=w)
    elif name == 'pool':
        for k in range(3):
            yy = y0 + s * (.42 + .22 * k)
            pts = [(x0 + i * s / 16, yy + math.sin(i * math.pi / 2) * s * .06) for i in range(17)]
            d.line(pts, fill=col, width=w, joint='curve')
        d.line([(x0 + s * .3, y0 + s * .05), (x0 + s * .3, y0 + s * .45)], fill=col, width=w)
        d.line([(x0 + s * .62, y0 + s * .05), (x0 + s * .62, y0 + s * .45)], fill=col, width=w)
        d.arc([x0 + s * .3, y0 - s * .1, x0 + s * .62, y0 + s * .2], 180, 360, fill=col, width=w)
    elif name == 'sea':
        d.arc([cx - s * .22, y0 + s * .05, cx + s * .22, y0 + s * .5], 180, 360, fill=col, width=w)
        d.line([(x0, y0 + s * .5), (x1, y0 + s * .5)], fill=col, width=w)
        for k in range(2):
            yy = y0 + s * (.68 + .22 * k)
            pts = [(x0 + i * s / 16, yy + math.sin(i * math.pi / 2) * s * .05) for i in range(17)]
            d.line(pts, fill=col, width=w, joint='curve')
    elif name == 'key':
        d.ellipse([x0, cy - s * .2, x0 + s * .4, cy + s * .2], outline=col, width=w)
        d.line([(x0 + s * .4, cy), (x1, cy)], fill=col, width=w)
        d.line([(x1 - s * .1, cy), (x1 - s * .1, cy + s * .2)], fill=col, width=w)
    elif name == 'leaf':
        d.pieslice([x0, y0, x1, y1 + s * .3], 200, 340, outline=col, width=w)
        d.line([(cx, y1), (cx, y0 + s * .4)], fill=col, width=w)
    else:  # sun
        d.ellipse([cx - s * .2, cy - s * .2, cx + s * .2, cy + s * .2], outline=col, width=w)
        for k in range(8):
            a = k * math.pi / 4
            d.line([(cx + math.cos(a) * s * .32, cy + math.sin(a) * s * .32), (cx + math.cos(a) * s * .48, cy + math.sin(a) * s * .48)], fill=col, width=w)


# ── mini floor plan ──────────────────────────────────────────────────────────
def minimap(spec):
    W = int(spec.get('width', 250)) * SS
    rooms = spec['rooms']
    route = spec['route']
    pad = 12 * SS
    head = 22 * SS
    xs = [r['x'] for r in rooms] + [r['x'] + r['w'] for r in rooms]
    ys = [r['y'] for r in rooms] + [r['y'] + r['h'] for r in rooms] + [d['dot'][1] for d in route if 'dot' in d]
    ux0, ux1, uy0, uy1 = min(xs), max(xs), min(ys), max(ys) + 4
    k = (W - 2 * pad) / (ux1 - ux0)
    ph = int((uy1 - uy0) * k)
    H = pad + head + ph + pad
    base, m = card(W, H, 12 * SS)
    P = lambda x, y: (m + pad + (x - ux0) * k, m + pad + head + (y - uy0) * k)
    centre = {}
    for r in rooms:
        centre[r['id']] = ((r['x'] + r['w'] / 2), (r['y'] + r['h'] / 2))
    for d in route:
        if 'dot' in d:
            centre[d['id']] = tuple(d['dot'])
    labels = {d['id']: d.get('label') for d in route}
    for r in rooms:
        labels.setdefault(r['id'], r.get('label'))
        if labels.get(r['id']) is None:
            labels[r['id']] = r.get('label')
    f_head = font(8.5 * SS)
    f_room = font(9.5 * SS, 5)
    steps = [(float(d['at']) - float(spec.get('delay', 0.0)), d['id']) for d in route]   # `at` is a time of the film; the clip's own clock starts after `delay`

    def current(t):
        cur = steps[0][1]
        prev = cur
        t0 = 0.0
        for at, rid in steps:
            if t >= at:
                prev, cur, t0 = cur, rid, at
        return prev, cur, t0

    def frame(t):
        img = Image.new('RGBA', base.size, (0, 0, 0, 0))   # drawn on a clear layer (a translucent fill must blend with the card, not replace it)
        d = ImageDraw.Draw(img)
        prev, cur, t0 = current(t)
        visited = {rid for at, rid in steps if t >= at}
        # the plan
        for r in rooms:
            x0, y0 = P(r['x'], r['y'])
            x1, y1 = P(r['x'] + r['w'], r['y'] + r['h'])
            kind = r.get('kind', 'room')
            fill = (255, 255, 255, 14)
            edge = (255, 255, 255, 110)
            if kind == 'dim':
                fill, edge = (255, 255, 255, 6), (255, 255, 255, 55)
            elif kind == 'outdoor':
                fill = (150, 190, 120, 22)
            elif kind == 'pool':
                fill, edge = (80, 190, 230, 120), (160, 225, 245, 190)
            elif kind == 'wet':
                fill = (255, 255, 255, 20)
            if r['id'] in visited and kind != 'pool':
                fill = (255, 255, 255, 46) if kind != 'outdoor' else (150, 190, 120, 70)
            if r['id'] == cur:
                glow = 0.5 + 0.5 * math.sin((t - t0) * 5.0)
                fill = (ACCENT[0], ACCENT[1], ACCENT[2], int(120 + 60 * glow))
                edge = (255, 150, 140, 255)
            d.rounded_rectangle([x0, y0, x1, y1], 3 * SS, fill=fill, outline=edge, width=max(1, int(1.2 * SS)))
        # the way in: a small door mark on the outside edge
        # the header: title on the left, the room we are in on the right
        fh = font(8 * SS, 5)
        d.text((m + pad, m + pad - 1 * SS), spec.get('title', 'FLOOR PLAN'), font=fh, fill=(255, 255, 255, 150), anchor='lt')
        name = labels.get(cur) or ''
        sw = ease((t - t0) / 0.35)
        d.text((m + W - pad, m + pad - 2 * SS + (1 - sw) * 4 * SS), name.upper(), font=f_room, fill=(255, 255, 255, int(255 * sw)), anchor='rt')
        # the dot glides from the room we left to the one we are in
        cx0, cy0 = centre[prev]
        cx1, cy1 = centre[cur]
        g = ease((t - t0) / 0.7) if prev != cur else 1.0
        dx, dy = P(cx0 + (cx1 - cx0) * g, cy0 + (cy1 - cy0) * g)
        pulse = ((t - t0) % 1.6) / 1.6
        rr = (4 + 7 * pulse) * SS
        d.ellipse([dx - rr, dy - rr, dx + rr, dy + rr], outline=(255, 255, 255, int(200 * (1 - pulse))), width=max(1, SS))
        d.ellipse([dx - 3.6 * SS, dy - 3.6 * SS, dx + 3.6 * SS, dy + 3.6 * SS], fill=(255, 255, 255, 255))
        d.ellipse([dx - 2.2 * SS, dy - 2.2 * SS, dx + 2.2 * SS, dy + 2.2 * SS], fill=(ACCENT[0], ACCENT[1], ACCENT[2], 255))
        return Image.alpha_composite(base, img)

    return frame, base.size


# ── legend ───────────────────────────────────────────────────────────────────
def legend(spec):
    W = int(spec.get('width', 214)) * SS
    items = spec['items']
    pad = 14 * SS
    row = 25 * SS
    head = 20 * SS if spec.get('title') else 0
    H = pad + head + row * len(items) + pad - 4 * SS
    base, m = card(W, H, 12 * SS)
    f_item = font(12.5 * SS, 5)
    f_head = font(8 * SS, 5)
    stagger = float(spec.get('stagger', 0.28))

    def frame(t):
        img = Image.new('RGBA', base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        if spec.get('title'):
            d.text((m + pad, m + pad - 1 * SS), spec['title'], font=f_head, fill=(255, 255, 255, 150), anchor='lt')
        for i, it in enumerate(items):
            a = ease((t - i * stagger) / 0.4)
            if a <= 0:
                continue
            y = m + pad + head + i * row + row / 2 - 2 * SS + (1 - a) * 5 * SS
            icon(d, it['icon'], m + pad + 8 * SS, y, 15 * SS, (255, 255, 255, int(235 * a)))
            d.text((m + pad + 25 * SS, y), it['text'], font=f_item, fill=(255, 255, 255, int(255 * a)), anchor='lm')
        return Image.alpha_composite(base, img)

    return frame, base.size


def main():
    spec = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    fps = int(spec.get('fps', 24))
    delay = float(spec.get('delay', 0.0))
    duration = float(spec['duration'])
    fade_out_at = spec.get('fadeOutAt')
    frame, size = (minimap if spec['kind'] == 'minimap' else legend)(spec)
    w, h = size[0] // SS, size[1] // SS
    tmp = tempfile.mkdtemp(prefix='kbov-')
    try:
        n = int(round(duration * fps))
        blank = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        for i in range(n):
            t = i / fps
            if t < delay:
                blank.save(os.path.join(tmp, 'f%04d.png' % i))
                continue
            img = frame(t - delay)
            a_in = ease((t - delay) / 0.5)
            a_out = 1.0 if fade_out_at is None else 1 - ease((t - float(fade_out_at)) / 0.5)
            alpha = img.getchannel('A').point(lambda v: int(v * a_in * a_out))
            img.putalpha(alpha)
            img.resize((w, h), Image.LANCZOS).save(os.path.join(tmp, 'f%04d.png' % i))
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(fps), '-i', os.path.join(tmp, 'f%04d.png'),
                        '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', os.path.abspath(out)], check=True)
        print('%s: %dx%d, %d frames' % (out, w, h, n))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


main()
