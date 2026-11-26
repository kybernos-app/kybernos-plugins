"""A three-legged stool: the smallest complete model of the skill (solids, checks, report, .glb).

    python model.py        (`node model.mjs build .` runs it with the toolchain's python)

Replace build() with your own solids. Everything else stays: Kit.check() refuses a part that is not a closed valid solid, write_glb() ships the
meshes the page shows, and the report carries the exact volumes and masses the legend quotes. Millimetres, Z up, parts drawn at their assembled pose.
"""
import math
import os
import sys
from build123d import *

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kbcad import Kit, write_json  # noqa: E402

SEAT_R, SEAT_T = 150.0, 30.0        # seat: radius and thickness
LEG_R, LEG_H, LEG_AT = 16.0, 450.0, 105.0   # legs: radius, height, distance from the axis
BEECH = 0.70                        # g/cm3


def cyl(r, z0, z1, x=0.0, y=0.0):
    return Pos(x, y, (z0 + z1) / 2) * Cylinder(r, z1 - z0)


def build():
    kit = Kit()
    kit.add('seat', cyl(SEAT_R, LEG_H, LEG_H + SEAT_T), 'beech', BEECH, display='Seat')
    for part, deg in (('leg_a', 90), ('leg_b', 210), ('leg_c', 330)):
        x, y = LEG_AT * math.cos(math.radians(deg)), LEG_AT * math.sin(math.radians(deg))
        kit.add(part, cyl(LEG_R, 0, LEG_H, x, y), 'beech', BEECH, display='Leg ' + part[-1].upper())
    return kit


if __name__ == '__main__':
    kit = build()
    rep = kit.check()
    size = kit.write_glb(os.path.join(HERE, 'model.glb'))
    total = round(sum(r['mass_g'] for r in rep.values()), 1)
    write_json(os.path.join(HERE, 'model-report.json'), dict(parts=rep, order=list(rep), total_mass_g=total))
    print('%d parts, %.1f g, model.glb %d KB' % (len(rep), total, size // 1024))
