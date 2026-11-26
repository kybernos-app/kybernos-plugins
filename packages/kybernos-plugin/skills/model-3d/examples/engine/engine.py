"""The four-stroke engine of the 3D shelf, built with a CAD kernel (build123d / OpenCascade).

Single cylinder, 56 x 50 mm, 90 mm rod, compression ratio 10: the numbers come from engine-params.json,
written by export-params.mjs from the same module the page runs (engine-sim.mjs), so the model and the
simulation cannot drift apart. Parts are drawn at their reference pose (crank at top dead centre), mm, Z up:
the cylinder axis is Z, the crankshaft axis is Y and goes through the origin.

Cutaway: block, head, crankcase and pipes are cut in half (the half with y < 0 is removed) and the cut face is a
separate thin slab, so the page can colour it. Moving parts are left whole.

    python engine.py        (writes engine.glb + engine-report.json; `node model.mjs build .` runs it with the right python)
"""
import json
import math
import os
import sys
from build123d import *

sys.path.insert(0, os.path.dirname(__file__))
from kbcad import Kit, write_json

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
J = json.load(open(os.path.join(OUT, 'engine-params.json')))
P, LIFT = J['params'], J['lift']

# ---- numbers (mm) -------------------------------------------------------------------------------------------------
BORE, STROKE, ROD = P['bore'] * 1000, P['stroke'] * 1000, P['rod'] * 1000
R = STROKE / 2                       # crank radius
PIN0 = R + ROD                       # piston pin height at top dead centre
CH = 28.0                            # pin to crown
CROWN0 = PIN0 + CH                   # crown at top dead centre
SQUISH = 1.0
DECK = CROWN0 + SQUISH
CHAMBER = P['chamberClearance'] * 1000 - SQUISH      # recess depth in the head
ZC = DECK + CHAMBER                  # chamber ceiling
HEAD_TOP = 196.0
XV = {'in': -15.5, 'ex': 14.5}       # valve positions (in the cut plane y = 0)
DV = {'in': P['valves']['inDia'] * 1000, 'ex': P['valves']['exDia'] * 1000}
CRANK_PIN_R, MAIN_R = 14.0, 15.0
SPRING_Z0, SPRING_H = HEAD_TOP + 1.2, 15.5      # the wire is 2 mm thick: 0.2 mm of air under it and over it

# ---- helpers ------------------------------------------------------------------------------------------------------
def box(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)

def cyl(r, z0, z1, x=0, y=0):
    return Pos(x, y, (z0 + z1) / 2) * Cylinder(r, z1 - z0)

def cyl_y(r, y0, y1, x=0, z=0):
    return Pos(x, (y0 + y1) / 2, z) * (Rot(X=90) * Cylinder(r, y1 - y0))

def lathe(pts):
    """Solid of revolution around Z from (radius, z) points."""
    with BuildSketch(Plane.XZ) as sk:
        with BuildLine():
            Polyline(*pts, close=True)
        make_face()
    return revolve(sk.sketch, axis=Axis.Z)

def prism_xz(sketch, y0, y1):
    """A sketch drawn in (x, z) extruded along Y from y0 to y1."""
    face = Plane.XZ * sketch
    return Pos(0, (y0 + y1) / 2, 0) * extrude(face, amount=(y1 - y0) / 2, both=True)

def disc(r, x=0, z=0):
    return Pos(x, z) * Circle(r)

def polygon(pts):
    return Polygon(*pts, align=None)

def soft(shape, radius, pick):
    """Fillet the edges chosen by `pick`; keep the part as it is if the kernel refuses (and say so)."""
    try:
        edges = [e for e in shape.edges() if pick(e)]
        return shape.fillet(radius, edges) if edges else shape
    except Exception as e:
        print('  (fillet skipped: %s)' % str(e)[:60])
        return shape

def halves(shape, t=0.4):
    """Cut away y < 0. Returns (body, slab): the slab is the thin cut face, kept apart so it can be coloured."""
    body = shape & box(-1000, 1000, t, 1000, -1000, 1000)
    slab = shape & box(-1000, 1000, 0, t, -1000, 1000)
    return body, slab

# ---- piston group ---------------------------------------------------------------------------------------------------
def make_piston():
    # ring lands: three grooves, measured from the crown (crown = 143 in the reference drawing)
    d = CROWN0 - 143.0
    g = [(137.0, 138.5), (133.0, 134.5), (128.5, 131.0)]
    pts = [(0, CROWN0), (26.9, CROWN0), (27.9, CROWN0 - 1.0)]
    for lo, hi in g:
        pts += [(27.9, hi + d), (24.6, hi + d), (24.6, lo + d), (27.9, lo + d)]
    pts += [(27.95, g[-1][0] + d), (27.95, 99.5 + d), (27.4, 99 + d), (0, 99 + d)]
    # drop duplicated consecutive points
    clean = [pts[0]] + [p for i, p in enumerate(pts[1:], 1) if p != pts[i - 1]]
    body = lathe(clean)
    body = body - cyl(22.5, 99 + d - 1, CROWN0 - 10)                                 # hollow underneath, 10 mm crown
    for side in (-1, 1):                                                              # pin bosses, outside the rod
        y0, y1 = (10.5, 26.0) if side > 0 else (-26.0, -10.5)
        body = body + (cyl_y(9.0, y0, y1, z=PIN0) & cyl(27.0, 90, 150))
    body = body - cyl_y(7.05, -40, 40, z=PIN0)                                        # pin bore
    return body

def make_ring(z0, z1, rin=25.0, rout=27.99):
    d = CROWN0 - 143.0
    ring = cyl(rout, z0 + d, z1 + d) - cyl(rin, z0 + d - 1, z1 + d + 1)
    return ring - box(0.0, 30, -0.2, 0.2, z0 + d - 1, z1 + d + 1)                     # the end gap of a real ring

def make_pin():
    return cyl_y(7.0, -23, 23, z=PIN0) - cyl_y(4.5, -30, 30, z=PIN0)

# ---- connecting rod --------------------------------------------------------------------------------------------------
def make_rod():
    outline = disc(11, 0, PIN0) + disc(19, 0, R) + polygon([(-5.5, PIN0), (5.5, PIN0), (9.5, R), (-9.5, R)])
    small = prism_xz(disc(11, 0, PIN0), -10, 10)
    big = prism_xz(disc(19, 0, R), -12, 12)
    shank = prism_xz(polygon([(-5.5, PIN0), (5.5, PIN0), (9.5, R), (-9.5, R)]), -7, 7)
    rod = small + big + shank
    # I-section: a pocket on each face of the shank, leaving flanges at the edges
    pocket = polygon([(-2.6, PIN0 - 12), (2.6, PIN0 - 12), (5.6, R + 21), (-5.6, R + 21)])
    rod = rod - prism_xz(pocket, 4, 8) - prism_xz(pocket, -8, -4)
    rod = rod - cyl_y(7.05, -20, 20, z=PIN0) - cyl_y(14.05, -20, 20, z=R)               # pin bore and crank-pin bore
    cap_zone = box(-30, 30, -20, 20, R - 25, R)
    return rod - cap_zone, rod & cap_zone

# ---- crankshaft and flywheel -----------------------------------------------------------------------------------------
def make_crank():
    def web(y0, y1):
        arm = polygon([(-13, 0), (13, 0), (11, R), (-11, R)])
        sector = disc(42) & polygon([(0, 0), (-120, -43.7), (-120, -200), (120, -200), (120, -43.7)])
        sk = disc(19) + disc(17, 0, R) + arm + sector
        return prism_xz(sk, y0, y1)
    c = cyl_y(MAIN_R, -46, -21) + web(-21, -13) + cyl_y(CRANK_PIN_R, -13, 13, z=R) + web(13, 21)
    c = c + cyl_y(MAIN_R, 21, 62) + cyl_y(12.0, 62, 100)
    return c

def make_flywheel():
    f = cyl_y(60, 74, 88) + cyl_y(22, 72, 90)                                             # rim and hub, outside the crankcase face (y = 70)
    for k in range(5):
        a = math.radians(36 + 72 * k)
        f = f - cyl_y(12.5, 70, 100, x=40 * math.sin(a), z=40 * math.cos(a))
    f = f - cyl_y(12.05, 70, 100)
    f = f - prism_xz(polygon([(-2.2, 62), (2.2, 62), (0, 56)]), 73, 89)                  # the timing notch at top dead centre
    return f

# ---- block, crankcase, head -------------------------------------------------------------------------------------------
def make_barrel():
    b = cyl(36, 58, DECK) + cyl(47, 48, 58)
    for i in range(7):
        z = 66 + i * 11
        b = b + cyl(45, z, z + 3)
    return b - cyl(BORE / 2, 40, DECK + 1)

def make_crankcase():
    c = box(-58, 58, -70, 70, -55, 48)
    c = c - cyl_y(46, -50, 45) - cyl_y(15.05, 44, 80) - cyl(BORE / 2, -20, 49)
    c = c - cyl_y(15.05, -80, -44)                                                    # the other main bearing, out of the cut
    return c

def port_path(side):
    """Centre line of a port in the cut plane: up from the valve seat, round an elbow, out to the side of the head."""
    s = -1 if side == 'in' else 1
    x = XV[side]
    z1, rb = ZC + 14, 14.0
    with BuildLine() as ln:
        Line((x, 0, ZC + 1), (x, 0, z1))
        TangentArc((x, 0, z1), (x + s * rb, 0, z1 + rb), tangent=(0, 0, 1))
        Line((x + s * rb, 0, z1 + rb), (s * 70, 0, z1 + rb))
    return ln.wire()

def make_head():
    h = Pos(0, 0, (DECK + HEAD_TOP) / 2) * Box(94, 94, HEAD_TOP - DECK)
    h = soft(h, 10, lambda e: abs(e.length - (HEAD_TOP - DECK)) < 1e-6)
    h = h - cyl(26, DECK - 1, ZC)                                                     # combustion chamber
    for side in ('in', 'ex'):
        x, dv = XV[side], DV[side]
        rp = 7.0
        seat = lathe([(0, ZC - 0.2), (dv / 2 + 0.15, ZC - 0.2), (dv / 2 + 0.15, ZC + 1.0), (rp + 0.4, ZC + 1.0 + (dv / 2 - rp - 0.25)), (rp, ZC + 1.0 + (dv / 2 - rp)), (rp, ZC + 6), (0, ZC + 6)])
        h = h - Pos(x, 0, 0) * seat
        path = port_path(side)
        h = h - sweep(Plane(origin=(x, 0, ZC + 1), z_dir=(0, 0, 1)) * Circle(rp), path)
        h = h - cyl(2.85, ZC, HEAD_TOP + 12, x=x)                                       # valve guide bore
        h = h + (cyl(6.5, HEAD_TOP, HEAD_TOP + 9, x=x) - cyl(2.85, HEAD_TOP - 1, HEAD_TOP + 10, x=x))
    h = h - cyl(7.5, ZC + 12, HEAD_TOP + 1) - cyl(4.2, ZC - 1, ZC + 13)               # plug well and plug hole
    return h

def make_pipe(side):
    """The manifold stub that continues the port outside the head."""
    s = -1 if side == 'in' else 1
    zc = ZC + 14 + 14.0
    outer = Pos(s * 58, 0, zc) * (Rot(Y=90) * Cylinder(10.0, 24))
    bore = Pos(s * 58, 0, zc) * (Rot(Y=90) * Cylinder(7.0, 26))
    return outer - bore

# ---- valves, plug -----------------------------------------------------------------------------------------------------
def make_valve(side):
    dv = DV[side]
    pts = [(0, ZC), (dv / 2, ZC), (dv / 2, ZC + 1.0), (3.4, ZC + 1.0 + (dv / 2 - 3.4)), (2.75, ZC + 1.0 + (dv / 2 - 3.4) + 2.0), (2.75, ZC + 72), (0, ZC + 72)]
    return Pos(XV[side], 0, 0) * lathe(pts)

def make_spring(side):
    """A coil spring: a round wire swept along a helix drawn as short straight steps (a true helix surface meshes ten times heavier)."""
    x = XV[side]
    z0, z1, turns, rad, steps = SPRING_Z0, SPRING_Z0 + SPRING_H, 5, 8.6, 14
    pts = [(rad * math.cos(2 * math.pi * i / steps), rad * math.sin(2 * math.pi * i / steps), (z1 - z0) * i / (turns * steps)) for i in range(turns * steps + 1)]
    with BuildLine() as ln:
        Polyline(*pts)
    tangent = tuple((Vector(*pts[1]) - Vector(*pts[0])).normalized())
    coil = sweep(Plane(origin=pts[0], z_dir=tangent) * Circle(1.0), ln.wire(), transition=Transition.RIGHT)
    return Pos(x, 0, z0) * coil

def make_retainer(side):
    x = XV[side]
    z = SPRING_Z0 + SPRING_H + 1.2
    return (cyl(10.0, z, z + 2.0, x=x) + cyl(5.5, z + 2.0, z + 5.0, x=x)) - cyl(2.8, z - 1, z + 6, x=x)

def make_plug():
    """Metal shell (thread, hex, ground strap) and ceramic (insulator, centre electrode, terminal), as two parts."""
    z0 = ZC + 12                                   # the hex sits on the bottom of the plug well
    zb = ZC - 0.5                                  # the thread ends just inside the chamber ceiling
    shell = cyl(4.0, zb, z0) + hexagon_prism(12, z0, z0 + 5) - cyl(2.6, zb - 1, z0 + 6)
    shell = shell + box(2.8, 3.8, -0.6, 0.6, zb - 3.2, zb) + box(-0.6, 3.8, -0.6, 0.6, zb - 3.2, zb - 2.4)    # strap: down, then under the tip
    ceramic = cyl(2.5, zb + 1, z0 + 5) + cyl(4.75, z0 + 5, z0 + 45) + cyl(1.8, z0 + 45, z0 + 52) + cyl(0.8, zb - 1.5, zb + 1)
    return shell, ceramic

def hexagon_prism(across_flats, z0, z1):
    with BuildSketch(Plane.XY.offset(z0)) as sk:
        RegularPolygon(radius=across_flats / math.sqrt(3), side_count=6)
    return extrude(sk.sketch, amount=z1 - z0)

# ---- the kit ------------------------------------------------------------------------------------------------------------
def build():
    kit = Kit()
    print('piston group'); kit.add('piston', make_piston(), 'aluminium', 2.70)
    kit.add('ring_top', make_ring(137.25, 138.25), 'steel', 7.85)
    kit.add('ring_second', make_ring(133.25, 134.25), 'steel', 7.85)
    kit.add('ring_oil', make_ring(128.8, 130.7), 'steel', 7.85)
    kit.add('pin', make_pin(), 'steel', 7.85)
    print('rod'); rod, cap = make_rod(); kit.add('rod', rod, 'steel', 7.85); kit.add('rod_cap', cap, 'steel', 7.85)
    print('crank'); kit.add('crank', make_crank(), 'steel', 7.85); kit.add('flywheel', make_flywheel(), 'iron', 7.20)
    print('block'); barrel = make_barrel()
    print('crankcase'); case = make_crankcase()
    print('head'); head = make_head()
    for name, shape, mat in (('barrel', barrel, 'aluminium'), ('crankcase', case, 'aluminium'), ('head', head, 'aluminium')):
        body, slab = halves(shape)
        kit.add(name, body, mat, 2.70); kit.add(name + '_cut', slab, 'section')
    for side in ('in', 'ex'):
        print('valve', side)
        kit.add('valve_' + side, make_valve(side), 'steel', 7.85)
        kit.add('spring_' + side, make_spring(side), 'steel', 7.85)
        kit.add('retainer_' + side, make_retainer(side), 'steel', 7.85)
        body, slab = halves(make_pipe(side)); kit.add('pipe_' + side, body, side + 'pipe'); kit.add('pipe_' + side + '_cut', slab, 'section')
    metal, ceramic = make_plug(); kit.add('plug_metal', metal, 'steel', 7.85); kit.add('plug_ceramic', ceramic, 'ceramic', 3.6)
    return kit, dict(barrel=barrel, case=case, head=head)

if __name__ == '__main__':
    kit, full = build()
    rep = kit.check()
    size = kit.write_glb(os.path.join(OUT, 'engine.glb'))
    write_json(os.path.join(OUT, 'engine-report.json'), dict(parts=rep, constants=dict(ZC=ZC, DECK=DECK, CROWN0=CROWN0, PIN0=PIN0, R=R, ROD=ROD, XV=XV, SPRING_Z0=SPRING_Z0, SPRING_H=SPRING_H, HEAD_TOP=HEAD_TOP, BORE=BORE, PIPE_Z=ZC + 28.0, PORT_BEND=14.0)))
    print('%d parts, %.0f KB glb, %d triangles' % (len(rep), size / 1024, sum(r['triangles'] for r in rep.values())))
