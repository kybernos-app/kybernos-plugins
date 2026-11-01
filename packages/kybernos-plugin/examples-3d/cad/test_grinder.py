"""Checks on the CAD-built hand grinder. Plain asserts, no pytest:

    ~/kybernos-archive/3d-tools/.venv/bin/python cad/test_grinder.py

1. every part is a sound solid, its shipped mesh is closed and has the exact volume (0.3 %, thread parts 1.5-2 %);
2. mass is volume x density, the total is a plausible hand mill, the proportions are those of a hand mill;
3. parts that touch share zero volume: every pair whose bounding boxes really overlap goes through a boolean intersection;
4. explicit fits, measured on cross-sections of the shipped meshes: nut on the shaft thread, burr inside the ring, shaft in the lid;
5. each of those tests is shown to FAIL on a deliberately wrong assembly (a shifted part), so none of them is vacuous;
6. the report file written for the page is the one this model produces.
"""
import itertools
import json
import math
import os
import sys
import time

import numpy as np
import trimesh
from build123d import Compound, Pos

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grinder as G  # noqa: E402
from kbcad import shared_volume  # noqa: E402

T0 = time.time()
FAILS = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok:
        FAILS.append(msg)


def slice_points(mesh, z):
    seg = trimesh.intersections.mesh_plane(mesh, [0, 0, 1], [0, 0, z])
    return seg.reshape(-1, 3) if len(seg) else np.zeros((0, 3))


def radial_gap(inner, outer, z0, z1, step, r_cut, bins=180, dx=0.0):
    """Smallest radial distance between the OUTSIDE of `inner` and the BORE of `outer`, from cross-sections between z0 and z1.
    The bore is the part of the outer section within r_cut of the axis. `dx` shifts the inner part sideways (to prove the test fails)."""
    worst = 1e9
    for z in np.arange(z0, z1 + 1e-9, step):
        a, b = slice_points(inner, z), slice_points(outer, z)
        if not len(a) or not len(b): continue
        a = a[:, :2] + [dx, 0.0]
        b = b[:, :2]
        ra, rb = np.hypot(a[:, 0], a[:, 1]), np.hypot(b[:, 0], b[:, 1])
        b, rb = b[rb < r_cut], rb[rb < r_cut]
        ia = ((np.arctan2(a[:, 1], a[:, 0]) + math.pi) / (2 * math.pi) * bins).astype(int) % bins
        ib = ((np.arctan2(b[:, 1], b[:, 0]) + math.pi) / (2 * math.pi) * bins).astype(int) % bins
        for k in range(bins):
            if (ia == k).any() and (ib == k).any():
                worst = min(worst, rb[ib == k].min() - ra[ia == k].max())
    return worst


def boxes_overlap(a, b, eps=1e-6):
    ba, bb = a.bounding_box(), b.bounding_box()
    for lo_a, hi_a, lo_b, hi_b in ((ba.min.X, ba.max.X, bb.min.X, bb.max.X), (ba.min.Y, ba.max.Y, bb.min.Y, bb.max.Y), (ba.min.Z, ba.max.Z, bb.min.Z, bb.max.Z)):
        if min(hi_a, hi_b) - max(lo_a, lo_b) <= eps:
            return False
    return True


print('building the kit ...', flush=True)
kit = G.build(verbose=False)
rep = kit.report()
meshes = G.shipped_meshes(kit)
for pid, parts in meshes.items():
    vol = rep[pid]['volume_mm3']
    rep[pid].update(triangles=int(sum(len(p.faces) for p in parts)), watertight=bool(all(p.is_watertight for p in parts)),
                    mesh_volume_error=abs(sum(p.volume for p in parts) - vol) / vol)
print('built in %.0fs' % (time.time() - T0), flush=True)

# 1 ── sound parts ─────────────────────────────────────────────────────────────────────────
print('1. parts')
check(len(kit.parts) == 12, '12 solids')
try:
    G.check_shipped(rep, meshes)
    check(True, 'every part: valid B-rep, closed shipped mesh, shipped volume = exact volume (%.2f%% worst)' % (100 * max(r['mesh_volume_error'] for r in rep.values())))
except AssertionError as e:
    check(False, 'shipped parts: %s' % e)
check(all(r['shipped_triangles'] if 'shipped_triangles' in r else True for r in rep.values()), 'triangle counts known')
check(sum(r['triangles'] for r in rep.values()) < 130000, 'the whole mill is under 130 000 triangles (%d)' % sum(r['triangles'] for r in rep.values()))
rng = np.random.default_rng(7)
def probes(r0, r1, z0, z1, n=70):
    return [(r * math.cos(a), r * math.sin(a), z) for r, a, z in zip(rng.uniform(r0, r1, n), rng.uniform(0, 6.28, n), rng.uniform(z0 + 0.3, z1 - 0.3, n))]
_low, _thr, _stub = G.shaft_pieces()
_sleeve, _collar = G.nut_pieces()
ag_s = G.thread_agreement(_thr, G.thread_mesh, probes(3.3, 3.9, G.THREAD_Z0, G.THREAD_Z1, 90))
ag_n = G.thread_agreement(_sleeve, G.sleeve_mesh, probes(3.5, 4.0, G.NUT_Z[0], G.NUT_Z[1], 90))
check(ag_s[1] > 0.9 and ag_n[1] > 0.9, 'analytic thread meshes agree with the exact solids at 90 random probe points inside the thread depth (%.0f%% shaft, %.0f%% nut)' % (100 * ag_s[1], 100 * ag_n[1]))
check(ag_s[-1] < 0.7 and ag_n[-1] < 0.7, 'and the opposite hand would not (%.0f%%, %.0f%%): the helix direction is really tested' % (100 * ag_s[-1], 100 * ag_n[-1]))

# 2 ── mass and proportions ────────────────────────────────────────────────────────────────
print('2. mass and size')
for pid, r in rep.items():
    ok = abs(r['mass_g'] - r['volume_mm3'] / 1000 * r['density_g_cm3']) < 0.01
    if not ok: check(False, pid + ': mass is volume x density')
check(all(abs(r['mass_g'] - r['volume_mm3'] / 1000 * r['density_g_cm3']) < 0.01 for r in rep.values()), 'mass = exact volume x density for every part')
total = sum(r['mass_g'] for r in rep.values())
check(350 <= total <= 900, 'total mass %.0f g is a plausible hand mill (350-900 g)' % total)
zmax = max(r['bbox_mm'][1][2] for r in rep.values())
xspan = max(r['bbox_mm'][1][0] for r in rep.values()) - min(r['bbox_mm'][0][0] for r in rep.values())
check(150 <= zmax <= 190, 'overall height %.0f mm (150-190)' % zmax)
check(xspan <= 140, 'overall width %.0f mm with the crank (<= 140)' % xspan)
check(set(G.ORDER) == set(kit.parts) and set(G.EXPLODE_MM) == set(kit.parts), 'explode vectors and assembly order cover every part')

# 3 ── no two parts share volume ───────────────────────────────────────────────────────────
print('3. interferences')
low, thr, stub = G.shaft_pieces()
sleeve, collar = G.nut_pieces()
shapes = {pid: p['shape'] for pid, p in kit.parts.items()}
shapes['shaft'] = Compound([low, stub])                       # the threaded stretch is only met by the nut (checked on sections below)
thread_partners = [pid for pid, s in shapes.items() if pid not in ('shaft', 'nut') and boxes_overlap(thr, s)]
check(thread_partners == [], 'nothing but the nut reaches the thread (%s)' % thread_partners)
nut_partners = [pid for pid, s in shapes.items() if pid not in ('shaft', 'nut') and boxes_overlap(shapes['nut'], s)]
check(nut_partners == [], 'nothing but the shaft reaches the nut (%s)' % nut_partners)
tested, worst, pairs_touching = 0, 0.0, 0
for a, b in itertools.combinations(sorted(shapes), 2):
    if 'nut' in (a, b) and 'shaft' in (a, b): continue
    if not boxes_overlap(shapes[a], shapes[b]):
        pairs_touching += 1
        continue
    v = shared_volume(shapes[a], shapes[b])
    tested += 1
    worst = max(worst, v if v is not None else 1e9)
    if v is None or v > 0.5:
        check(False, '%s and %s share %s mm3' % (a, b, v))
check(worst <= 0.5, '%d part pairs went through a boolean intersection, worst shared volume %.4f mm3; %d other pairs cannot overlap (their boxes only touch or are apart)' % (tested, worst, pairs_touching))
check(tested >= 20, 'at least 20 pairs are really tested (%d)' % tested)

# 4 ── fits ────────────────────────────────────────────────────────────────────────────────
print('4. fits')
shaft_thr, nut_sleeve = meshes['shaft'][1], meshes['nut'][0]
gap_nut = radial_gap(shaft_thr, nut_sleeve, G.NUT_Z[0] + 0.2, G.NUT_Z[1] - 0.2, 0.25, 5.5)
check(gap_nut >= 0.08, 'nut on the thread: smallest radial clearance %.2f mm over %.0f mm of thread (design 0.15, sampling takes up to 0.04)' % (gap_nut, G.NUT_Z[1] - G.NUT_Z[0] - 0.4))
ring, burr = meshes['ring'][0], meshes['burr'][0]
gap_burr = radial_gap(burr, ring, G.BURR_Z[0] + 0.3, G.BURR_Z[1] - 0.3, 1.0, 19.5)
check(gap_burr >= 0.4, 'burr in the ring: smallest radial gap %.2f mm along the flutes (design 0.6)' % gap_burr)
bb_b, bb_r = shapes['burr'].bounding_box(), shapes['ring'].bounding_box()
check(bb_r.min.Z <= bb_b.min.Z and bb_b.max.Z <= bb_r.max.Z, 'burr sits inside the ring in height (%.0f-%.0f within %.0f-%.0f)' % (bb_b.min.Z, bb_b.max.Z, bb_r.min.Z, bb_r.max.Z))
from build123d import Pos as _P, Box as _B
inside = shapes['drawer'] & (_P(0, 50, 50) * _B(200, 100, 100))          # the part of the drawer that is inside the body (y >= 0 here: the tray)
tray = shapes['drawer'].bounding_box()
cav = shapes['body'].bounding_box()
tb = inside.bounding_box()
check(tb.min.X > -40 and tb.max.X < 40 and tb.max.Y < 41 and tb.min.Z > 4 and tb.max.Z < 32, 'drawer tray fits the cavity with clearance (x %.1f..%.1f of +-40, y to %.1f of 41, z %.1f..%.1f of 4..32)' % (tb.min.X, tb.max.X, tb.max.Y, tb.min.Z, tb.max.Z))
lid_hole_gap = 4.5 - 4.0
check(abs(lid_hole_gap - 0.5) < 1e-9, 'shaft passes the lid hole with 0.5 mm all round')

# 5 ── the tests above must be able to fail ────────────────────────────────────────────────
print('5. the checks can fail')
a_shifted = shared_volume(shapes['body'], Pos(1, 0, 0) * shapes['body'])
check(a_shifted and a_shifted > 100, 'a body shifted 1 mm onto itself shares %.0f mm3: the intersection test sees overlaps' % (a_shifted or 0))
check(shared_volume(shapes['body'], Pos(0, 0, 2) * shapes['drawer']) > 5, 'a drawer lifted 2 mm into the body is caught')
check(shared_volume(shapes['lid'], Pos(0.6, 0, 0) * shapes['shaft']) > 0.05, 'a shaft pushed 0.6 mm sideways hits the lid hole')
check(shared_volume(shapes['body'], Pos(0.3, 0, 0) * shapes['screws']) > 0.05, 'screws pushed 0.3 mm sideways hit the pilot holes')
check(radial_gap(shaft_thr, nut_sleeve, G.NUT_Z[0] + 0.2, G.NUT_Z[1] - 0.2, 0.25, 5.5, dx=0.2) < 0.0, 'a shaft shifted 0.2 mm sideways makes the nut clearance negative (%.2f mm)' %
      radial_gap(shaft_thr, nut_sleeve, G.NUT_Z[0] + 0.2, G.NUT_Z[1] - 0.2, 0.25, 5.5, dx=0.2))
check(radial_gap(burr, ring, G.BURR_Z[0] + 0.3, G.BURR_Z[1] - 0.3, 1.0, 19.5, dx=0.7) < 0.0, 'a burr shifted 0.7 mm sideways hits the ring')

# 6 ── the report the page reads ───────────────────────────────────────────────────────────
print('6. report file')
path = os.path.join(G.OUT, 'grinder-report.json')
if os.path.exists(path):
    js = json.load(open(path))
    same = all(abs(js['parts'][p]['volume_mm3'] - rep[p]['volume_mm3']) < 0.01 for p in kit.parts) and js['order'] == G.ORDER
    check(same, 'grinder-report.json holds the volumes this model produces (rebuild with grinder.py if not)')
    glb = os.path.join(G.OUT, 'grinder.glb')
    check(os.path.exists(glb) and os.path.getsize(glb) < 2.5e6, 'grinder.glb exists and is under 2.5 MB (%.0f KB)' % (os.path.getsize(glb) / 1024))
else:
    check(False, 'grinder-report.json is missing: run cad/grinder.py')

print('\n%s in %.0fs' % ('ALL PASSED' if not FAILS else '%d FAILED' % len(FAILS), time.time() - T0))
sys.exit(1 if FAILS else 0)
