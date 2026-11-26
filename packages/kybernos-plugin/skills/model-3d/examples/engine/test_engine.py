"""Checks on the CAD engine: the parts are sound, they fit, the compression ratio read from the geometry is the
simulation's, and nothing in the moving assembly ever passes through anything else over the whole cycle.

    python test_engine.py
"""
import json
import math
import os
import sys
import time
from build123d import *

sys.path.insert(0, os.path.dirname(__file__))
import engine as E
from kbcad import shared_volume

n_checks = 0


def ok(cond, msg):
    global n_checks
    n_checks += 1
    if not cond:
        raise AssertionError(msg)


t0 = time.time()
kit, full = E.build()
rep = kit.check()
ok(len(rep) == 27, 'part count')
S = {k: v['shape'] for k, v in kit.parts.items()}
barrel, case, head = full['barrel'], full['case'], full['head']

# ---- 1. what touches what at rest must not share volume -----------------------------------------------------------------
MAXV = 0.5       # mm3: a shared volume this small is the mesh of a face, not a collision
static = [('piston', 'pin'), ('pin', 'rod'), ('rod', 'crank'), ('rod_cap', 'crank'), ('rod', 'rod_cap'),
          ('ring_top', 'piston'), ('ring_second', 'piston'), ('ring_oil', 'piston'), ('flywheel', 'crank'),
          ('plug_ceramic', 'plug_metal'), ('retainer_in', 'valve_in'), ('retainer_ex', 'valve_ex'),
          ('spring_in', 'retainer_in'), ('spring_ex', 'retainer_ex'), ('valve_in', 'valve_ex')]
for a, b in static:
    v = shared_volume(S[a], S[b])
    ok(v is not None and v < MAXV, f'{a} / {b} share {v} mm3 at rest')
against_full = [('piston', barrel), ('ring_top', barrel), ('ring_second', barrel), ('ring_oil', barrel), ('crank', case), ('flywheel', case),
                ('rod', case), ('valve_in', head), ('valve_ex', head), ('plug_metal', head), ('plug_ceramic', head), ('spring_in', head),
                ('spring_ex', head), ('piston', head), ('barrel', head), ('barrel', case), ('valve_in', barrel), ('valve_ex', barrel)]
for a, other in against_full:
    v = shared_volume(S[a] if isinstance(a, str) else a, other)
    ok(v is not None and v < MAXV, f'{a} shares {v} mm3 with a block part at rest')
print('rest fits ok (%d pairs, %.0f s)' % (len(static) + len(against_full), time.time() - t0))

# ---- 2. the compression ratio is read from the geometry, then compared with the simulation's -----------------------------
A = math.pi * E.BORE ** 2 / 4
Vd = A * E.STROKE
envelope = E.cyl(30, E.CROWN0, E.ZC)
gas = envelope - barrel - head - S['piston'] - S['valve_in'] - S['valve_ex'] - S['plug_metal'] - S['plug_ceramic']
Vc = gas.volume
cr = (Vc + Vd) / Vc
print('chamber %.0f mm3, displacement %.0f mm3, compression ratio read from the CAD: %.3f' % (Vc, Vd, cr))
ok(abs(cr - E.P['cr']) < 0.15, f'compression ratio {cr:.3f} is not the simulation\'s {E.P["cr"]}')
ok(abs(Vd / 1e3 - 123.15) < 0.1, f'displacement {Vd / 1e3:.2f} cm3')

# ---- 3. the whole cycle: poses from the same kinematics the page uses ---------------------------------------------------------
lift_in = {d: i for d, i, _ in E.LIFT}
lift_ex = {d: x for d, _, x in E.LIFT}
R, L, PIN0 = E.R, E.ROD, E.PIN0
pin_z = lambda th: R * math.cos(math.radians(th)) + math.sqrt(L * L - (R * math.sin(math.radians(th))) ** 2)
rod_tilt = lambda th: math.degrees(math.asin(R * math.sin(math.radians(th)) / L))


def poses(th):
    dz = pin_z(th) - PIN0
    up = lambda s: Pos(0, 0, dz) * s
    rod_axis = Axis((0, 0, PIN0), (0, 1, 0))
    place_rod = lambda s: Pos(0, 0, dz) * s.rotate(rod_axis, -rod_tilt(th))
    spin = lambda s: s.rotate(Axis.Y, th)
    d = int(round(th)) % 720
    return dict(
        piston=up(S['piston']), rings=[up(S[k]) for k in ('ring_top', 'ring_second', 'ring_oil')], pin=up(S['pin']),
        rod=place_rod(S['rod']), cap=place_rod(S['rod_cap']), crank=spin(S['crank']), fly=spin(S['flywheel']),
        vin=Pos(0, 0, -lift_in[d] * 1000) * S['valve_in'], vex=Pos(0, 0, -lift_ex[d] * 1000) * S['valve_ex'])


worst = {}
def sweep_check(name, a, b, th):
    v = shared_volume(a, b)
    worst[name] = max(worst.get(name, 0.0), v if v is not None else 1e9)
    ok(v is not None and v < MAXV, f'{name} share {v} mm3 at {th} deg')

angles = list(range(0, 720, 15))
t1 = time.time()
for th in angles:
    p = poses(th)
    sweep_check('piston/barrel', p['piston'], barrel, th)
    for r in p['rings']:
        sweep_check('ring/barrel', r, barrel, th)
    sweep_check('piston/head', p['piston'], head, th)
    sweep_check('rod/barrel', p['rod'], barrel, th)
    sweep_check('rod/crankcase', p['rod'], case, th)
    sweep_check('cap/crankcase', p['cap'], case, th)
    sweep_check('rod/piston', p['rod'], p['piston'], th)
    sweep_check('rod/pin', p['rod'], p['pin'], th)
    sweep_check('rod/crank', p['rod'], p['crank'], th)
    sweep_check('cap/crank', p['cap'], p['crank'], th)
    sweep_check('crank/crankcase', p['crank'], case, th)
    sweep_check('flywheel/crankcase', p['fly'], case, th)
    sweep_check('crank/piston', p['crank'], p['piston'], th)
    sweep_check('valve_in/piston', p['vin'], p['piston'], th)
    sweep_check('valve_ex/piston', p['vex'], p['piston'], th)
    sweep_check('valve_in/head', p['vin'], head, th)
    sweep_check('valve_ex/head', p['vex'], head, th)
print('motion sweep: %d angles, %d pair checks, worst shared volume %.3f mm3 (%.0f s)' % (len(angles), n_checks, max(worst.values()), time.time() - t1))

# ---- 4. the closest approach, against what the simulation says --------------------------------------------------------------
for th in (0, 15, 705, 360):
    p = poses(th)
    d_in = p['vin'].distance_to(p['piston'])
    d_ex = p['vex'].distance_to(p['piston'])
    d = int(th) % 720
    expect_in = E.P['chamberClearance'] * 1000 - lift_in[d] * 1000 + (PIN0 - pin_z(th))       # gap + how far the piston has come down
    expect_ex = E.P['chamberClearance'] * 1000 - lift_ex[d] * 1000 + (PIN0 - pin_z(th))
    ok(abs(d_in - expect_in) < 0.1, f'intake valve to piston at {th} deg: CAD {d_in:.2f} mm, simulation {expect_in:.2f} mm')
    ok(abs(d_ex - expect_ex) < 0.1, f'exhaust valve to piston at {th} deg: CAD {d_ex:.2f} mm, simulation {expect_ex:.2f} mm')
print('valve-to-piston distances agree with the simulation')

# ---- 5. the test can fail: break the assembly on purpose ----------------------------------------------------------------------
bad_piston = Pos(0, 0, 9.0) * S['piston']
ok(shared_volume(bad_piston, head) > 100, 'a piston lifted 9 mm must hit the head')
bad_valve = Pos(0, 0, -9.0) * S['valve_in']
ok(shared_volume(bad_valve, S['piston']) > 50, 'a valve opened 9 mm at top dead centre must hit the piston')
bad_rod = S['rod'].rotate(Axis((0, 0, PIN0), (0, 1, 0)), 40)
ok(shared_volume(bad_rod, case) > 50 or shared_volume(bad_rod, barrel) > 50, 'a rod tilted 40 degrees must hit the block')
print('negative controls detected')

# ---- 6. masses the lesson can quote -----------------------------------------------------------------------------------------------
m = lambda *names: sum(rep[n]['mass_g'] for n in names)
recip = m('piston', 'ring_top', 'ring_second', 'ring_oil', 'pin')
print('piston group %.0f g, rod %.0f g, crank %.0f g' % (recip, m('rod', 'rod_cap'), m('crank')))
ok(100 < recip < 220, 'a 56 mm aluminium piston with rings and pin weighs about 150 g')

print('engine CAD: %d checks passed in %.0f s' % (n_checks, time.time() - t0))
from kbcad import write_json
write_json(os.path.join(E.OUT, 'engine-checks.json'), dict(
    parts=len(rep), compressionRatio=round(cr, 3), chamberMm3=round(Vc), sweepAngles=len(angles), pairChecks=n_checks,
    worstSharedMm3=round(max(worst.values()), 4), restPairs=len(static) + len(against_full), pistonGroupG=round(recip)))
