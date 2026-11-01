"""Hand coffee grinder (a wooden box mill) built with a real CAD kernel, for the « Hand grinder, exploded » shelf example.

Twelve solids at their assembled pose, millimetres, Z up, front of the drawer toward -Y:
  body, drawer, top plate, screws x4, outer burr ring, inner burr, drive shaft, hopper, lid, adjusting nut, crank arm, crank handle.

What is real here (and checked in test_grinder.py): box-joint seams on the body, a drawer with a turned knob, a countersunk plate
with slotted screws, an inner burr with helical flutes and an outer ring with grooves, a shaft with a true helical thread and a nut
with the matching internal thread (0.15 mm clearance), turned hopper, lid and handle. Mass comes from the exact B-rep volume.

    ~/kybernos-archive/3d-tools/.venv/bin/python cad/grinder.py     # writes ../grinder/grinder.glb and grinder-report.json
"""
import math
import os
import sys
import time

from build123d import *

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import trimesh
from kbcad import Kit, write_json, mesh_of, _TO_THREE  # noqa: E402

OUT = os.path.normpath(os.path.join(HERE, '..', 'grinder'))
MIN = (Align.CENTER, Align.CENTER, Align.MIN)

# ── the numbers the whole model hangs on (mm) ───────────────────────────────────────────────
W, H = 96.0, 70.0                    # body: footprint and height
WALL = 7.0                           # wall of the box (box-joint board thickness)
Z_PART = (32.0, 37.0)                # partition between the drawer cavity and the grinding chamber
BORE_R = 20.2                        # bore that takes the outer burr ring
Z_PLATE = (70.0, 72.0)               # top plate
RING_Z = (37.0, 68.0)
BURR_Z = (39.0, 66.0)
BURR_R0, BURR_R1 = 9.0, 15.0         # tip radius of the cone at the bottom / at the top
BURR_GAP = 0.6                       # radial gap between the burr tips and the ring
HOPPER_TOP = 100.0
LID_Z = (100.0, 108.0)
SHAFT_Z0, THREAD_Z0, THREAD_Z1, SHAFT_Z1 = 38.0, 108.0, 120.0, 134.0
PITCH, T_RMIN, T_RMAJ, T_CLEAR = 1.25, 3.2, 4.0, 0.15
NUT_Z = (109.0, 120.0)
HUB_Z = (120.0, 130.0)
ARM_Z = (120.0, 125.0)
ARM_LEN = 58.0
HANDLE_Z = (125.0, 165.0)

DENSITY = {'walnut': 0.65, 'beech': 0.72, 'brass': 8.5, 'steel': 7.85, 'tool steel': 7.8}


# ── small tools ─────────────────────────────────────────────────────────────────────────────
def cyl(r, h, x=0.0, y=0.0, z=0.0):
    return Pos(x, y, z) * Cylinder(r, h, align=MIN)


def box(x0, x1, y0, y1, z0, z1):
    x0, x1, y0, y1, z0, z1 = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1)
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def revolved(pts):
    """Closed polygon of (radius, z) points turned around Z."""
    with BuildSketch(Plane.XZ) as sk:
        with BuildLine():
            Polyline(*pts, close=True)
        make_face()
    return revolve(sk.sketch, axis=Axis.Z)


def strip(mid, t):
    """Polygon of a thin wall of thickness t around the (radius, z) centre line `mid` (mitred at the corners)."""
    n, left, right = len(mid), [], []
    seg = [(mid[i + 1][0] - mid[i][0], mid[i + 1][1] - mid[i][1]) for i in range(n - 1)]
    seg = [(dx / math.hypot(dx, dz), dz / math.hypot(dx, dz)) for dx, dz in seg]
    nor = [(-dz, dx) for dx, dz in seg]                           # left normal of each segment
    for i, (r, z) in enumerate(mid):
        if i == 0: nx, nz, k = nor[0][0], nor[0][1], 1.0
        elif i == n - 1: nx, nz, k = nor[-1][0], nor[-1][1], 1.0
        else:
            bx, bz = nor[i - 1][0] + nor[i][0], nor[i - 1][1] + nor[i][1]
            bl = math.hypot(bx, bz); bx, bz = bx / bl, bz / bl
            k = 1.0 / max(0.4, bx * nor[i][0] + bz * nor[i][1]); nx, nz = bx, bz
        left.append((r + nx * t / 2 * k, z + nz * t / 2 * k)); right.append((r - nx * t / 2 * k, z - nz * t / 2 * k))
    return left + right[::-1]


def star(r_tip, r_root, n, rot_deg):
    out = []
    for i in range(2 * n):
        a = math.radians(rot_deg) + math.pi * i / n
        r = r_tip if i % 2 == 0 else r_root
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


def star_loft(zs, tip, root, n, twist):
    """Ruled loft through star sections. (A smoothed loft through 7 sections overshot the cone by 1.5 mm at both ends.)"""
    secs = [Plane.XY.offset(z) * Polygon(*star(tip(z), root(z), n, twist(z)), align=None) for z in zs]
    return loft(secs, ruled=True)


def thread_pts(r_min, r_maj, n=48):
    """Cross-section of a single-start thread: the radius follows the axial profile of one pitch (flat root, flanks, flat crest)."""
    pts = []
    for i in range(n):
        phi, t = 2 * math.pi * i / n, i / n
        tri = 1 - abs(2 * t - 1)
        w = min(1.0, max(0.0, (tri - 0.2) / 0.6))
        r = r_min + (r_maj - r_min) * w
        pts.append((r * math.cos(phi), r * math.sin(phi)))
    return pts


def twisted(face, z0, length, pitch):
    """A section turned 360 * length / pitch degrees while it rises: an exact helical thread."""
    face = face.moved(Location((0, 0, z0)))
    return Solid.extrude_linear_with_rotation(face, (0, 0, z0), (0, 0, length), 360.0 * length / pitch)


def cone_tip(z):
    return BURR_R0 + (BURR_R1 - BURR_R0) * (z - BURR_Z[0]) / (BURR_Z[1] - BURR_Z[0])


# ── the parts ───────────────────────────────────────────────────────────────────────────────
def make_body():
    b = box(-W / 2, W / 2, -W / 2, W / 2, 0, H)
    b = b.fillet(1.2, b.edges().filter_by(Axis.Z, reverse=True))
    b = b - box(-40, 40, -W / 2 - 1, 41, 4, Z_PART[0])                     # drawer cavity, open to the front
    b = b - cyl(12, Z_PART[1] - Z_PART[0] + 0.2, z=Z_PART[0] - 0.1)          # the hole ground coffee falls through
    b = b - cyl(BORE_R, H - Z_PART[1] + 1, z=Z_PART[1])                      # bore for the outer burr ring
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = b - cyl(1.5, 8.0, sx * 43, sy * 43, Z_PLATE[0] - 8.0)       # pilot holes of the four screws
    # box joints: the seams of five fingers on every vertical corner, as 0.35 mm V-less grooves
    d, w, zs = 0.35, 0.5, [14, 28, 42, 56]
    even = [(1.5, 14), (28, 42), (56, H - 1.5)]
    odd = [(14, 28), (42, 56)]
    cuts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in zs:
                cuts.append(box(sx * 41, sx * 48.5, sy * (W / 2 - d), sy * (W / 2 + 0.5), z - w / 2, z + w / 2))       # on the front / back face
                cuts.append(box(sx * (W / 2 - d), sx * (W / 2 + 0.5), sy * 41, sy * 48.5, z - w / 2, z + w / 2))       # on the side face
            for z0, z1 in odd:
                cuts.append(box(sx * 41 - w / 2, sx * 41 + w / 2, sy * (W / 2 - d), sy * (W / 2 + 0.5), z0, z1))
            for z0, z1 in even:
                cuts.append(box(sx * (W / 2 - d), sx * (W / 2 + 0.5), sy * 41 - w / 2, sy * 41 + w / 2, z0, z1))
    return b - Compound(cuts)


def make_drawer():
    tray = box(-39, 39, -48, 39.5, 5, 31) - box(-36.5, 36.5, -45.5, 37, 7.5, 32)
    panel = box(-43, 43, -51, -48, 2.5, 33.5)
    front = panel.faces().sort_by(Axis.Y)[0]
    panel = panel.chamfer(1.2, None, front.edges())
    ts = [i / 20 for i in range(21)]
    pts = [(0, 0), (3.5, 0)] + [(3.5 + 5.5 * math.sin(math.pi * t) ** 0.75, 3 + 10 * t) for t in ts] + [(0, 13)]
    knob = revolved(pts)                                                    # turned along +Z, then laid toward the front (-Y)
    knob = Pos(0, -51, 18) * (Rot(90, 0, 0) * knob)
    return tray + panel + knob


def make_plate():
    p = box(-W / 2, W / 2, -W / 2, W / 2, Z_PLATE[0], Z_PLATE[1])
    p = p.fillet(4.0, p.edges().filter_by(Axis.Z))
    p = p - cyl(18, 4, z=Z_PLATE[0] - 1)
    cutter = revolved([(0, 1), (4.2, 1), (1.7, -1.5), (1.7, -3), (0, -3)])  # countersunk hole, 90 degrees
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = p - Pos(sx * 43, sy * 43, Z_PLATE[1]) * cutter
    return p


def make_screws():
    one = revolved([(0, 0), (3.2, 0), (1.5, -1.7), (1.5, -(Z_PLATE[1] - (Z_PLATE[0] - 8.0))), (0, -(Z_PLATE[1] - (Z_PLATE[0] - 8.0)))])
    one = one - box(-3.5, 3.5, -0.4, 0.4, -0.9, 0.5)                        # the slot
    return Compound([Pos(sx * 43, sy * 43, Z_PLATE[1]) * (Rot(0, 0, 45 * (sx * sy)) * one) for sx in (-1, 1) for sy in (-1, 1)])


def make_ring():
    r = cyl(BORE_R - 0.2, RING_Z[1] - RING_Z[0], z=RING_Z[0])
    r = r.chamfer(0.6, None, r.edges().filter_by(GeomType.CIRCLE))
    zs = [RING_Z[0] - 0.5 + i * (RING_Z[1] - RING_Z[0] + 1) / 6 for i in range(7)]
    teeth = star_loft(zs, tip=lambda z: cone_tip(z) + BURR_GAP + 1.4, root=lambda z: cone_tip(z) + BURR_GAP, n=18, twist=lambda z: 0)
    return r - teeth


def make_burr():
    zs = [BURR_Z[0] + i * (BURR_Z[1] - BURR_Z[0]) / 12 for i in range(13)]
    cone = star_loft(zs, tip=cone_tip, root=lambda z: cone_tip(z) - 1.5, n=14, twist=lambda z: 70.0 * (z - BURR_Z[0]) / (BURR_Z[1] - BURR_Z[0]))
    return cone - cyl(4.0, BURR_Z[1] - BURR_Z[0] + 2, z=BURR_Z[0] - 1)


def shaft_pieces():
    """Plain shank, thread, stub: the shaft is their union. The pieces are kept apart because the thread is meshed analytically."""
    low = cyl(4.0, THREAD_Z0 - SHAFT_Z0, z=SHAFT_Z0)
    low = low.chamfer(0.6, None, low.edges().filter_by(GeomType.CIRCLE).filter_by_position(Axis.Z, SHAFT_Z0 - 0.01, SHAFT_Z0 + 0.01))
    thr = twisted(Face(Polyline(*thread_pts(T_RMIN, T_RMAJ), close=True)), THREAD_Z0, THREAD_Z1 - THREAD_Z0, PITCH)
    stub = cyl(3.0, SHAFT_Z1 - THREAD_Z1, z=THREAD_Z1)
    stub = stub.chamfer(0.6, None, stub.edges().filter_by(GeomType.CIRCLE).filter_by_position(Axis.Z, SHAFT_Z1 - 0.01, SHAFT_Z1 + 0.01))
    return low, thr, stub


def make_shaft():
    low, thr, stub = shaft_pieces()
    return low + thr + stub


def make_hopper():
    t = 1.0
    parts = [strip([(17.0, 69), (17.0, 74), (29.0, 80), (29.0, 98), (30.5, 99.5)], t),      # throat, funnel, wall, bead
             strip([(29.0, 80.5), (29.0, 72.5), (33.5, 72.5)], t)]                          # skirt and foot ring that stand on the plate
    h = revolved(parts[0]) + revolved(parts[1])
    return h


def make_lid():
    return revolved([(4.5, LID_Z[0]), (33, LID_Z[0]), (33, 101.8), (27, 104), (15, 106.6), (11, LID_Z[1]), (4.5, LID_Z[1])])


def nut_pieces():
    """Two machined pieces of one brass nut: a threaded sleeve (the internal thread is cut by one twisted extrusion, exact helix)
    and a knurled, chamfered collar pressed on it. They touch along a cylinder; neither is cut from the other, which keeps the
    kernel fast (a boolean between a helical thread and 26 knurl flutes took minutes)."""
    ring = Face(Wire.make_circle(6.5, Plane.XY), [Wire(Polyline(*thread_pts(T_RMIN + T_CLEAR, T_RMAJ + T_CLEAR), close=True))])
    sleeve = twisted(ring, THREAD_Z0, THREAD_Z1 - THREAD_Z0, PITCH) & cyl(7, NUT_Z[1] - NUT_Z[0], z=NUT_Z[0])
    knurl = []
    for i in range(52):
        a = math.pi * i / 26
        r = 10.5 if i % 2 == 0 else 9.9
        knurl.append((r * math.cos(a), r * math.sin(a)))
    collar = extrude(Face(Polyline(*knurl, close=True)).moved(Location((0, 0, NUT_Z[0]))), amount=NUT_Z[1] - NUT_Z[0])
    collar = collar & revolved([(0, NUT_Z[0]), (9.7, NUT_Z[0]), (10.6, NUT_Z[0] + 0.9), (10.6, NUT_Z[1] - 0.9), (9.7, NUT_Z[1]), (0, NUT_Z[1])])
    collar = collar - cyl(6.5, NUT_Z[1] - NUT_Z[0] + 2, z=NUT_Z[0] - 1)
    return sleeve, collar


def make_nut():
    return Compound(list(nut_pieces()))


# ── analytic meshes of the two threads (the kernel's own tessellation of a 10-turn sweep is two million triangles) ─────────────────
STEPS_PER_TURN = 24


def _rot(pts, a):
    c, s_ = math.cos(a), math.sin(a)
    return [(x * c - y * s_, x * s_ + y * c) for x, y in pts]


def thread_surface(pts, z0, z1, hand=1):
    """The sweep of the closed polygon `pts` (the section at THREAD_Z0) turned like the kernel turns it, sampled at STEPS_PER_TURN."""
    n, k_steps = len(pts), int(math.ceil(STEPS_PER_TURN * (z1 - z0) / PITCH))
    v, f = [], []
    for k in range(k_steps + 1):
        z = z0 + (z1 - z0) * k / k_steps
        v += [(x, y, z) for x, y in _rot(pts, hand * 2 * math.pi * (z - THREAD_Z0) / PITCH)]
    for k in range(k_steps):
        for i in range(n):
            a, b, c, d = k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i
            f += [(a, b, c), (a, c, d)]
    return v, f


def thread_mesh(hand=1):
    """Closed mesh of the shaft thread: swept surface plus a fan on each end."""
    pts = thread_pts(T_RMIN, T_RMAJ)
    v, f = thread_surface(pts, THREAD_Z0, THREAD_Z1, hand)
    n, last = len(pts), len(v) - len(pts)
    for base, z, up in ((0, THREAD_Z0, False), (last, THREAD_Z1, True)):
        v.append((0, 0, z)); c = len(v) - 1
        for i in range(n):
            a, b = base + i, base + (i + 1) % n
            f.append((c, a, b) if up else (c, b, a))
    return trimesh.Trimesh(v, f, process=True)


def sleeve_mesh(hand=1):
    """Closed mesh of the nut sleeve between NUT_Z: internal thread, outer cylinder (area-true polygon), two annular caps."""
    pts = thread_pts(T_RMIN + T_CLEAR, T_RMAJ + T_CLEAR)
    n = len(pts)
    v, f = thread_surface(pts, NUT_Z[0], NUT_Z[1], hand)
    f = [(a, c, b) for a, b, c in f]                                       # the bore faces the axis: flip
    k_steps = len(v) // n - 1
    ro = 6.5 * math.sqrt((2 * math.pi / n) / math.sin(2 * math.pi / n))
    for z, up in ((NUT_Z[0], False), (NUT_Z[1], True)):
        base = 0 if not up else k_steps * n
        o0 = len(v)
        v += [(ro * math.cos(2 * math.pi * i / n), ro * math.sin(2 * math.pi * i / n), z) for i in range(n)]
        for i in range(n):
            ia, ib, oa, ob = base + i, base + (i + 1) % n, o0 + i, o0 + (i + 1) % n
            tri = [(ia, oa, ob), (ia, ob, ib)]
            f += tri if up else [(a, c, b) for a, b, c in tri]
    # outer cylinder
    lo, hi = len(v), len(v) + n
    v += [(ro * math.cos(2 * math.pi * i / n), ro * math.sin(2 * math.pi * i / n), NUT_Z[0]) for i in range(n)]
    v += [(ro * math.cos(2 * math.pi * i / n), ro * math.sin(2 * math.pi * i / n), NUT_Z[1]) for i in range(n)]
    for i in range(n):
        a, b = i, (i + 1) % n
        f += [(lo + a, lo + b, hi + b), (lo + a, hi + b, hi + a)]
    return trimesh.Trimesh(v, f, process=True)


def thread_agreement(solid, mesh, probes):
    """Share of probe points that the analytic mesh and the exact solid classify the same way (inside / outside)."""
    truth = [bool(solid.is_inside(Vector(*p))) for p in probes]
    return {h: sum(1 for p, t in zip(probes, truth) if bool(mesh(h).contains([p])[0]) == t) / len(probes) for h in (1, -1)}


# ── what ships: the kernel's mesh for every part, the analytic one for the two threads ────────────────────────────────────────
def shipped_meshes(kit):
    """{part id: [trimesh, ...]} in millimetres, CAD axes. The two threads are assembled from pieces that touch.
    The kernel turns the section counter-clockwise looking down (hand = 1); test_grinder.py proves it against the exact solids."""
    low, thr, stub = shaft_pieces()
    sleeve, collar = nut_pieces()
    out = {pid: [mesh_of(p['shape'], *p['tess'])] for pid, p in kit.parts.items() if pid not in ('shaft', 'nut')}
    out['shaft'] = [mesh_of(low), thread_mesh(1), mesh_of(stub)]
    out['nut'] = [sleeve_mesh(1), mesh_of(collar)]
    return out


def write_glb(meshes, path):
    scene = trimesh.Scene()
    for pid, parts in meshes.items():
        m = trimesh.util.concatenate(parts)
        m.apply_scale(0.001)
        m.apply_transform(_TO_THREE)
        scene.add_geometry(m, node_name=pid, geom_name=pid)
    data = scene.export(file_type='glb')
    with open(path, 'wb') as f:
        f.write(data)
    return len(data)


def make_crank():
    hub = cyl(8.0, HUB_Z[1] - HUB_Z[0], z=HUB_Z[0])
    bar = extrude(Plane.XY.offset(ARM_Z[0]) * (Pos(ARM_LEN / 2, 0) * SlotCenterToCenter(ARM_LEN, 14)), amount=ARM_Z[1] - ARM_Z[0])
    c = hub + bar
    c = c + cyl(2.2, HANDLE_Z[1] - 4 - (ARM_Z[1] - 1), ARM_LEN, 0, ARM_Z[1] - 1)       # the pin the handle turns on
    c = c - cyl(3.0, HUB_Z[1] - HUB_Z[0] + 2, z=HUB_Z[0] - 1)                            # hub bore on the shaft stub
    return c


def make_handle():
    ts = [i / 24 for i in range(25)]
    L = HANDLE_Z[1] - HANDLE_Z[0]
    bore_top = L - 4
    pts = [(2.2, 0), (5.2, 0), (6.2, 1.0)] + [(6.0 + 2.6 * math.sin(math.pi * t ** 0.85), 1 + (L - 5) * t) for t in ts[1:]] \
        + [(3.6, L - 1.0), (2.4, L), (0, L), (0, bore_top), (2.2, bore_top)]
    return Pos(ARM_LEN, 0, HANDLE_Z[0]) * revolved(pts)


# ── the kit ─────────────────────────────────────────────────────────────────────────────────
PARTS = [  # id, builder, display name, material, density key, process
    ('body', make_body, 'Body', 'walnut', 'walnut', 'CNC cut, box joints, hand finished'),
    ('drawer', make_drawer, 'Drawer', 'beech', 'beech', 'CNC cut, turned knob'),
    ('ring', make_ring, 'Outer burr ring', 'hardened steel', 'tool steel', 'Turned, ground, hardened'),
    ('burr', make_burr, 'Inner burr', 'hardened steel', 'tool steel', 'Turned, fluted, ground, hardened'),
    ('shaft', make_shaft, 'Drive shaft', 'steel', 'steel', 'Turned, thread rolled'),
    ('plate', make_plate, 'Top plate', 'brass', 'brass', 'Laser cut, countersunk'),
    ('screws', make_screws, 'Screws ×4', 'steel', 'steel', 'Bought in (slotted wood screws)'),
    ('hopper', make_hopper, 'Hopper', 'brass', 'brass', 'Spun and soldered'),
    ('lid', make_lid, 'Lid', 'beech', 'beech', 'Turned'),
    ('nut', make_nut, 'Adjusting nut', 'brass', 'brass', 'Turned, knurled, tapped'),
    ('crank', make_crank, 'Crank arm', 'steel', 'steel', 'Cut, formed, riveted pin'),
    ('handle', make_handle, 'Crank handle', 'walnut', 'walnut', 'Turned'),
]

# How far each part travels when the view is exploded: millimetres, CAD axes (x right, y toward the back, z up). Chain gap 18 mm.
EXPLODE_MM = {
    'body': (0, 0, 0), 'drawer': (0, -90, 0), 'ring': (0, 0, 51), 'burr': (0, 0, 98), 'shaft': (75, 0, 60),
    'plate': (0, 0, 112), 'screws': (0, 0, 140), 'hopper': (0, 0, 133), 'lid': (0, 0, 151), 'nut': (0, 0, 168),
    'crank': (0, 0, 186), 'handle': (0, 0, 226),
}
ORDER = ['body', 'drawer', 'ring', 'burr', 'shaft', 'plate', 'screws', 'hopper', 'lid', 'nut', 'crank', 'handle']


def build(verbose=True):
    kit, t0 = Kit(), time.time()
    for pid, fn, name, mat, dens, proc in PARTS:
        s = fn()
        extra = {'burr': dict(tess=(0.005, 0.05)), 'shaft': dict(tess=(0.3, 1.0)), 'nut': dict(tess=(0.3, 1.0))}.get(pid, {})
        kit.add(pid, s, mat, DENSITY[dens], display=name, process=proc, **extra)
        if verbose:
            print('  %-8s %-18s %7.1f cm3  %5.1fs' % (pid, name, s.volume / 1000, time.time() - t0), flush=True)
    return kit


SHIPPED_TOLERANCE = {'shaft': 0.015, 'nut': 0.02}      # a sampled sweep is not the sweep: those two may differ more than the 0.3 % of the rest


def check_shipped(rep, meshes, default=0.003):
    """The rules every part must meet before it goes in the glb: sound B-rep, closed meshes, shipped volume equal to the exact one."""
    bad = []
    for pid, parts in meshes.items():
        r = rep[pid]
        if not r['valid']: bad.append(pid + ': invalid B-rep')
        if not r['volume_mm3'] > 0: bad.append(pid + ': empty')
        if not r['watertight']: bad.append(pid + ': a piece of the mesh is not closed')
        if r['mesh_volume_error'] > SHIPPED_TOLERANCE.get(pid, default): bad.append('%s: mesh volume off by %.2f%%' % (pid, r['mesh_volume_error'] * 100))
    if bad:
        raise AssertionError('; '.join(bad))


def main():
    os.makedirs(OUT, exist_ok=True)
    kit = build()
    rep = kit.report()
    meshes = shipped_meshes(kit)
    for pid, parts in meshes.items():
        vol = rep[pid]['volume_mm3']
        rep[pid].update(triangles=int(sum(len(p.faces) for p in parts)), watertight=bool(all(p.is_watertight for p in parts)),
                        mesh_volume_error=round(abs(sum(p.volume for p in parts) - vol) / vol, 5))
    check_shipped(rep, meshes)
    size = write_glb(meshes, os.path.join(OUT, 'grinder.glb'))
    total = sum(r['mass_g'] for r in rep.values())
    to_three = {k: [v[0] / 1000, v[2] / 1000, -v[1] / 1000] for k, v in EXPLODE_MM.items()}     # (x, up, toward the viewer), metres
    write_json(os.path.join(OUT, 'grinder-report.json'), dict(parts=rep, order=ORDER, explode_m=to_three, total_mass_g=round(total, 1)))
    print('glb %.0f KB, %d triangles, total mass %.0f g' % (size / 1024, sum(r['triangles'] for r in rep.values()), total))


if __name__ == '__main__':
    main()
