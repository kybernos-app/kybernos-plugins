# kybernos-modeleur

**From the DSH chat, the agent draws a 2D or 3D model; it animates in the right
sidebar, object by object, then is read back.**

```
DSH chat ──(tool `modeliser`)──▶ host ──(GET /kybernos-modeleur/state)──▶ “3D modeller” panel (“Modeleur” in French)
```

## What it does

| Half | File | Role |
|---|---|---|
| Host | `index.js` | The `modeliser` tool + two routes. Holds the store (one order per session), the space (2d/3d) and the **laying clock** (`t0`, `dureeMs`). Draws nothing. |
| Client | `client.js` | Right-sidebar panel: a scaled 2D engine (SVG-like ops), a 3D solids engine (facets + painter's sort), an op executor, a transport (play, speeds, cursor, replay). |

The panel **does not play a local animation**: it lays
`total × (now − t0) / duration` objects, from the host's clock. A tab that
arrives late catches up instead of replaying from zero.

## The two spaces

### 3D — orbitable solids

```jsonc
[
  { "op": "box",     "x": -5, "y": -4, "z": 0, "w": 10, "d": 8, "h": 4, "color": "#EFE4C8" },
  { "op": "cone",    "cx": 0, "cy": 0, "z": 4, "r": 7, "h": 3, "color": "#8E1B14", "n": 4 },
  { "op": "cyl",     "cx": 0, "cy": 0, "z": 0, "r": 4, "r2": 2.5, "h": 15, "color": "#EFE4C8" },
  { "op": "sphere",  "cx": 0, "cy": 0, "cz": 18, "r": 1.4, "color": "#F2C31A" },
  { "op": "tube",    "cx": 0, "cy": 0, "z": 16, "r": 3, "t": 0.6, "h": 2.5, "color": "#D9C08C" },
  { "op": "extrude", "points": [[0,0],[6,0],[3,4]], "z": 0, "h": 2, "color": "#7C848A" }
]
```

`n:4` on a cone = a square pyramidal roof, and `rot: 45` aligns its edges on
the diagonals (straight walls). `r2` on a cylinder = a truncated cone
(a tapered tower). `fond:true` adds the bottom face. The rendering is a painter's
sort — key = depth of the **farthest point** of each facet,
and the covered ceilings (horizontal faces under the highest point) are
drawn first — so the solids are **juxtaposed**, not interpenetrating.

### « Redraw → readjust » loop

The ✏ brush of the panel annotates over the model — **5 tools**: freehand stroke
([perfect-freehand](https://github.com/steveruizok/perfect-freehand) engine,
felt-tip strokes of variable thickness), rectangle, ellipse and arrow
([Rough.js](https://roughjs.com/) hand-drawn engine, a stable seed per shape) and
text. 3 colours, an "Erase" button. The agent reads them back through `modeliser` with
`relire: true` — typed annotations in normalised 0..1 coordinates (rect/
ellipse = zone, arrow = direction, text = literal instruction, stroke =
circling or striking out) — then pushes the adjusted model with `mode:"modifier"`.
Host route: `POST /kybernos-modeleur/annote`; a new push starts again with a
clean sheet. MIT vendors inlined (~32 KB): zero dependency, zero CDN.

### 2D — scaled drawing

```jsonc
[
  { "op": "axes",  "x": 0, "y": 0, "w": 90, "h": 50 },
  { "op": "rect",  "x": 8, "y": 8, "w": 50, "h": 34 },
  { "op": "circle", "cx": 33, "cy": 25, "r": 10 },
  { "op": "arrow", "x1": 58, "y1": 25, "x2": 80, "y2": 25 },
  { "op": "path",  "d": "M10 44 C 25 50, 40 38, 55 44" },
  { "op": "text",  "x": 33, "y": 26, "text": "Ø 20", "anchor": "middle", "bold": true }
]
```

Mathematical frame (Y pointing up), fitted to the frame, grid at a round step
(`1/2/5×10^k`). Every op accepts `stroke`, `fill`, `width`, `dash`.

Both families are detailed in the **`modeleur-2d-3d`** skill
(`~/.dsh/skills/modeleur-2d-3d/SKILL.md`) — it is what teaches the DSL to the
models; this README only gives the shape.

## Chaining

`modeliser` with `mode: "modifier"` **adds** objects to the current model,
only in the same space: going from 3D to 2D necessarily starts from a new
model (the store enforces it, not the client). Only the new objects are animated.

## Installation

The profile must list the package — `dsh.profile.bundles` **and** a `link:`
dependency in `~/.dsh/profiles/web/package.json`, plus the matching symbolic link in
`node_modules/@local/`. A DSH restart is required
(the list of bundles is read at startup):

```bash
ln -s <your checkout>/packages/kybernos-modeleur \
      ~/.dsh/profiles/web/node_modules/@local/kybernos-modeleur
# then add "@local/kybernos-modeleur" to dsh.profile.bundles and restart DSH
```

The panel opens **by itself** when a model arrives, and the **3D modeller** tab type
stays offered at all times by the selector (`+`) of the right
sidebar. No button in the footer of the sidebar (same decision as
kybernos-bricks).

## Tests

```bash
node test-host.mjs      # the tool + the routes on a real HTTP server
node test-client.mjs    # 2D/3D engines, op executor, wiring — no browser
```

`test-client.mjs` checks in particular: facets per primitive, bounds, the painter's
sort (fill in the family of the colour), invalid 2D ops ignored,
path parser (absolute, relative, `Z` that closes), partial laying, and the
three demos of the empty state with no batch lost.

## Decisions

- **Canvas 2D, not Three.js/WebGL.** Facets + the painter's sort are enough for
  juxtaposed solids, and the package keeps **zero dependency**: no CDN, no
  node_modules.
- **The clock is on the host.** Otherwise two tabs open on the same session
  play two different animations.
- **`t0` + catch-up.** The panel joins the chat's clock; it does not restart
  when it mounts.
- **An in-memory `Map`, no persistence.** A model is a show, not a
  document — to keep one, the chat asks for the model again.
- **Changing space starts from zero** (enforced by the host): overlaying a 2D
  plan on a 3D scene makes no visual sense.
