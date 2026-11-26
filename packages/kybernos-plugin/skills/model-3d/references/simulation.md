# Computed behaviour (road C)

Use when the page shows numbers that must be right because they come from a physical or arithmetic model: a pressure curve, a flow, a load, a cost. The pattern is `examples/engine`.

## One source of truth

- The model is ONE plain module (`engine-sim.mjs`), no import, no DOM, exports only: it runs in node for the tests and is inlined in the page (`"sim"` in model.json).
- The CAD script reads its dimensions from that module through a generated json (`export-params.mjs` writes `engine-params.json`; `engine.py` reads it). The solids and the numbers cannot drift apart because neither has its own copy.
- The page reads every number from the module's results, never from literals.

## Write the model from what is known

State the model in the header of the module, in a few lines: what is modelled, the textbook law used for each part, what is left out. Prefer the standard set (conservation of mass and energy, an equation of state, a flow through an orifice, a published curve with named parameters) over a hand-shaped curve. Units in names or comments, SI inside, friendly units only at the edge. Say on the page which values are indicated (before losses) and which are simplified.

## Tests that decide

For each, a number that is computed independently or a law that must hold:

1. **Geometry and kinematics against closed forms** (stroke, volumes at the extremes, the piston is not at mid-stroke at 90° because the rod is finite).
2. **A conserved quantity**: with the sources switched off the quantity is constant (entropy along an adiabatic compression; mass while both valves are closed; the energy balance closes: change in gas energy = heat released − wall loss − work).
3. **Limits**: results sit in the range a real device shows (peak pressure and its angle, efficiency below the ideal limit, residual gas, wall-heat share, peak temperature), each with the reason in the message.
4. **The switch that must change the answer does**: without the spark the peak is at top dead centre and much lower; closing the throttle lowers the work per cycle; advancing too far moves the peak earlier.
5. **Convergence**: the cycle repeats itself (the loop that runs it settles in a few turns, not dozens).
6. **The interpolation the page uses** gives the same numbers as the model at the grid points.

Run the node test with `node test-engine-sim.mjs` (no toolchain needed: it is part of the plugin's test suite).

## Do not

- tune a constant until a test passes without saying so: a fitted constant is an assumption, written as one;
- show a result the tests do not cover as "computed";
- present a simplified model as a design tool: say what it ignores.
