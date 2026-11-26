"""The checks of the stool. They decide whether the model is sound; add yours as the model grows.

    python test_model.py        (`node model.mjs check .`)

A check that cannot fail proves nothing: every kind of check below is shown to fail on a model that is broken on purpose.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build123d import *  # noqa: E402
from kbcad import shared_volume  # noqa: E402
import model as M  # noqa: E402

n = 0


def ok(cond, msg):
    global n
    n += 1
    if not cond:
        raise AssertionError(msg)


kit = M.build()
rep = kit.check()                      # every part: valid B-rep, closed mesh, mesh volume = exact volume
ok(len(rep) == 4, 'four parts: a seat and three legs')
S = {k: v['shape'] for k, v in kit.parts.items()}

# 1. what touches must not overlap: a leg meets the seat under its face, it does not go through it
for leg in ('leg_a', 'leg_b', 'leg_c'):
    v = shared_volume(S[leg], S['seat'])
    ok(v is not None and v < 0.5, f'{leg} shares {v} mm3 with the seat')
for a, b in (('leg_a', 'leg_b'), ('leg_b', 'leg_c'), ('leg_a', 'leg_c')):
    v = shared_volume(S[a], S[b])
    ok(v is not None and v < 0.5, f'{a} and {b} share {v} mm3')

# 2. the check can fail: a leg pushed 5 mm up into the seat must be caught
pushed = Pos(0, 0, 5) * S['leg_a']
ok(shared_volume(pushed, S['seat']) > 100, 'a leg pushed 5 mm into the seat must share volume with it')

# 3. the numbers the page quotes come from the geometry
seat_g = math.pi * M.SEAT_R ** 2 * M.SEAT_T / 1000 * M.BEECH
ok(abs(rep['seat']['mass_g'] - seat_g) < 0.5, 'the seat mass is volume x density')
total = sum(r['mass_g'] for r in rep.values())
ok(1500 < total < 3000, f'a beech stool of this size weighs about 2 kg, not {total:.0f} g')
print('stool: %d checks passed' % n)
