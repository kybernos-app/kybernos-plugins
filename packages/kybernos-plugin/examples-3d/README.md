# 3D shelf examples

Examples for the « 3D model » entry of the new-chat shelf. Each one is a small page whose numbers are **computed, not
written**, and whose solids come from a CAD kernel, not from hand-placed primitives. The armchair is the exception: a
simple e-commerce configurator built from primitives in the host page.

| Example | Solids | Numbers | Checked by |
|---|---|---|---|
| Hand grinder, exploded | `cad/grinder.py` (build123d, 12 parts, a real helical thread and burr) → `grinder/grinder.glb` | mass = exact volume × density, cost per batch (`grinder/bom.mjs`) | `cad/test_grinder.py`, `grinder/test-bom.mjs` |
| Four-stroke engine | `cad/engine.py` (27 parts, cutaway) → `engine/engine.glb` | slider-crank kinematics, single-zone first-law pressure with a Wiebe burn, valve events (`engine/engine-sim.mjs`) | `cad/test_engine.py`, `engine/test-engine-sim.mjs` |

## Rebuild

```bash
# once: the CAD toolchain (Python 3.11+, build123d, trimesh, numpy)
python3 -m venv ~/kybernos-archive/3d-tools/.venv && ~/kybernos-archive/3d-tools/.venv/bin/pip install build123d trimesh numpy fast-simplification rtree

cd packages/kybernos-plugin/examples-3d
PY=~/kybernos-archive/3d-tools/.venv/bin/python
$PY cad/grinder.py && $PY cad/test_grinder.py      # about 2 minutes: boolean checks on a real kernel
$PY cad/engine.py  && $PY cad/test_engine.py       # about 15 seconds
node engine/test-engine-sim.mjs && node grinder/test-bom.mjs
node page/build-page.mjs /tmp/shelf-3d-examples.html   # one self-contained html, the .glb files inlined
```

The Python tests are not part of `scripts/run-all-tests.mjs` (they need the CAD toolchain). The two node tests have no dependency.

## What the tests prove

- Every part is a valid closed solid whose mesh volume equals the exact volume.
- No two parts occupy the same space: pairwise boolean intersections (bounding-box prefiltered), and for the engine at 48 crank angles.
- Each test is shown to **fail** on a deliberately shifted assembly (a test that cannot fail proves nothing).
- The simulation obeys what it must: entropy stays constant along an adiabatic cycle, mass is constant while both valves are closed, the cycle converges to a repeating state, and every result sits in its physical range (peak pressure and its angle, indicated efficiency under the Otto limit, residual gas, wall-heat share, peak gas temperature).

## Traps found while building these

- Boolean operations between helical solids and other solids take minutes in the kernel: thread fit is checked on cross-sections, and thread meshes are generated analytically.
- A smooth loft between twisted star sections overshoots: use a ruled loft.
- A revolved cone apex, or a boolean on the axis, can leave open mesh edges: keep a small flat.
- `from build123d import *` shadows a variable named `G`.
