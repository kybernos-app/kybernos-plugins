# Verification recipes

All with `scripts/kit/kbcad.py` (copied next to your model as `kbcad.py`) and build123d. Examples: `examples/blank/test_model.py` (the smallest), `examples/grinder/test_grinder.py`, `examples/engine/test_engine.py`.

## Every part

```python
rep = kit.check()      # raises with every problem listed; returns the report
```

A part passes when it is a valid B-rep, has a positive volume, its tessellation is closed (watertight) and its mesh volume is within 0.3 % of the exact volume (`vtol=` per part loosens that for a part only meant to be looked at, such as a spring: say so).

## What touches must not overlap

```python
from kbcad import shared_volume
v = shared_volume(S['shaft'], S['plate'])
assert v is not None and v < 0.5, f'shaft and plate share {v} mm3'     # 0.5 mm3 is a mesh face, not a collision
```

`shared_volume(a, b)` is the volume of `a & b` (0.0 when they only touch or do not meet, `None` when the kernel failed or could not measure the result: treat `None` as a failure). Write the pairs down as a list, one line each, with the reason ("the drawer slides in the body").

Moving parts: pose the part with the same kinematics the page uses, at enough positions to cover the travel, and test against the static parts:

```python
for th in range(0, 720, 15):
    p = Pos(0, 0, pin_z(th) - PIN0) * S['piston']
    assert shared_volume(p, barrel) < 0.5
```

Use the **same formula** as the page (one function in a shared module, or one JSON of parameters), never a second copy.

An **exploded view is a motion too**: every part moves along its vector `v` by a fraction `f` of the travel (the page multiplies by an eased 0..1). Sweep `f` from 0 to 1 in 10 to 20 steps and assert that nothing overlaps on the way (`Pos(*[c * f for c in v]) * shape`), and that a screw leaves its hole along the hole's axis.

## Fasteners and holes

A screw that sits in wood must not overlap it, so the wood has a hole. Keep the **undrilled** solid (the blank) next to the drilled one and measure with it:

```python
def engaged_mm(screw, blank, r):
    """How many mm of the shank sit in this wood: shared volume of screw and undrilled wood / shank section."""
    v = shared_volume(screw, blank)
    return None if v is None else v / (math.pi * r * r)

assert engaged_mm(screw, side_blank, SR) >= 17.9          # it crosses the whole 18 mm side
assert engaged_mm(screw, shelf_blank, SR) >= 15           # and is held at least 15 mm in the shelf (a number YOU choose: say it)
```

Clearance of a hole around a screw: the wood removed by the hole, divided by its length, gives the hole's cross-section; assert it is larger than the shank's by the margin you want. Count the fasteners from the geometry (the parts that exist), and compare with the schedule you wrote by hand. Negative controls: a screw 3 mm sideways (it hits the wood), a screw pulled 15 mm out (engagement drops), a hole smaller than the shank (negative clearance).

Pose a negative control **where the check can see it**: a screw 3 mm off its axis is caught in its hole, not once the exploded view has pulled it out of it.

## Clearance, from sections

For a shaft in a bore (or any helical fit), do not intersect the solids: cut both at a few heights and measure the smallest radial gap between the outside of one and the bore of the other (`examples/grinder/test_grinder.py`, `radial_gap`). Assert `gap >= wanted` and keep a negative control with a gap below 0.

## Negative controls (every check must be able to fail)

```python
pushed = Pos(0, 0, 5) * S['leg_a']
assert shared_volume(pushed, S['seat']) > 100, 'the test must see a leg pushed into the seat'
```

One control per kind of check: a part moved into another, a part rotated too far, a clearance made negative, a total made wrong. If you cannot make a check fail, it checks nothing: rewrite it.

## Numbers

- Mass: `kit.report()` gives `volume_mm3` and `mass_g` (volume / 1000 × density). Test one against a hand formula (`π r² t ρ`).
- Totals and sanity ranges: assert the total is in a plausible range for the real object, with the reason in the message.
- Anything quoted on the page (a ratio, a clearance, a count of checks) is read from the geometry or the test results and written to a json that the page reads (`engine-checks.json`): the page never carries a number the tests did not produce.
- A cost or a price is arithmetic on **shown assumptions** (`examples/grinder/bom.mjs`): test the arithmetic (the total equals the sum of the rows, a bigger batch never costs more per unit, a quantity below 1 is refused) and keep the assumptions in one object the page displays.

## Order of the work

1. Run the example untouched: green.
2. Change one thing, run `all`: green, or the failure is yours.
3. Add the check for what you just added, with its negative control.
4. Slow checks (helical solids, many poses) last, once the fast ones pass.
