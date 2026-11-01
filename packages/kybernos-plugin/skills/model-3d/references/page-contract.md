# The page: `model.json` and the page module

`node scripts/model.mjs page <dir>` builds ONE html file from the host page (`scripts/kit/host.template.html`) and what `<dir>/model.json` names.

## model.json

```json
{
  "title": "Name of the object",
  "build":  ["node export-params.mjs", "py model.py"],
  "checks": ["node test-sim.mjs", "py test_model.py"],
  "page": {
    "title": "Name of the object", "lede": "One or two sentences under the title.",
    "out": "model.html",
    "glb":  { "main": "model.glb" },
    "data": { "REPORT": "model-report.json", "CAD": "report.json#constants" },
    "sim": "sim.mjs",
    "modules": ["example.js"],
    "examples": ["partsExample({ ...env, parts: await loadParts(GLB.main), report: REPORT })"]
  }
}
```

- A step is `py <script>` (the toolchain's python) or `node <script>`; the script is a file of the folder, nothing else is ever run. Steps stop at the first failure. `build` writes the `.glb` and the reports, `checks` are the tests.
- `glb`: `GLB.<key>` holds the file as base64; `await loadParts(GLB.main)` returns a `Map<part id, THREE.BufferGeometry>` in metres, Y up, creased normals applied. Part ids are the names the CAD script gave; **a trailing `_<digits>` is stripped** (`leg_1` becomes `leg`), so name parts `leg_a`, `leg_front`, not `leg_1`.
- `data`: each entry becomes `const NAME = <json>;` (UPPER_SNAKE_CASE). `file.json#a.b` takes only that part.
- `sim`: a plain module (no import) whose `export`s are stripped: its functions are in scope for the example code. It is the same file a node test imports.
- `modules`: the example modules, in the same scope. `examples`: one expression per tab, evaluated in the page; more than one example shows a picker.
- `crumb` and `note` (optional, plain text, escaped) add a small line above the title and under the dialog.
- `strings` sets the words of the page itself, to write them in the person's language: `hint` (the chip over the scene), `export` (the button), `exported` (the message after Export, `{file}` and `{kb}` are replaced), `exportFailed`. What is missing stays English. The words of your own module (legend, buttons) are yours to write in the language.

## The page module

A plain ES module, no import. It exports a function that receives `env` and returns the example (it may be `async`).

`env` holds: `THREE`, `std(color, opts)` (a standard material), `mesh(geo, mat, x, y, z)`, `lathe([[r, y], ...])`, `shadowed(obj)`, `ease(t)`, `$`, `ctl` (the controls bar), `legend` (the right-hand panel), `reduced` (prefers-reduced-motion) and whatever the manifest adds (`parts`, `report`...). The host's own names are also in scope because everything is one script: `camera`, `controls`, `renderer`, `scene`, `toast(msg)`, `flyTo(pos, target)`, `eur(n)`, `clamp`, `countTo`.

It returns:

| Field | Meaning |
|---|---|
| `label`, `tag`, `sub` | the tab (shown when the page holds several examples) |
| `group` | the `THREE.Group` the host puts in the scene; real units are metres, Y up, the object roughly 0.1 to 1 m across |
| `cam` | `{ pos: [x, y, z], target: [x, y, z] }` where the camera starts |
| `autoRotate` | turn slowly until the person touches it |
| `file` | the name Export gives the `.glb`; objects with `userData.skipExport = true` are left out of it |
| `enter()` | the page switched to this example: reset the state, draw the legend and the controls |
| `act(name, value)` | a click on any element with `data-act="name" data-val="value"` (range inputs call it on every `input`) |
| `tick(dt)` | every frame, `dt` in seconds (capped at 0.05): animate |
| `pickables()`, `pointer('click' \| 'move', object)` | picking: the object a ray can hit, and what was clicked or hovered (or null) |

Markup and classes the host styles: in `ctl`, `.grp`, `.btn`, `.seg > button[aria-pressed]`, `.lab`, `input[type=range]`; in `legend`, `h3`, `.sub`, `.card` (`<b>` title, `<p>` lines). Colours come from the host's variables (`--ink`, `--muted`, `--line`, `--panel`, `--accent`, `--font-mono`, `--font-body`, `--font-display`), which already follow the light and dark theme: do not hard-code colours for text or lines. A module may add its own `<style>` once (see `examples/grinder/example.js`).

Exploded views: a part moves along its own vector, `report.explode_m[id] = [x, y, z]` in metres in the page's frame (Y up), which the CAD script writes into the report (see `examples/grinder`). The parts viewer of `examples/blank` uses it when present and otherwise spreads the parts along the height. A screw must travel with the same direction as the part it goes through, so that it stays on the axis of its hole all the way.

Rules that keep the page honest: every number on screen comes from `report`, a data file or the `sim` module, never typed into the module; an assumption is labelled as one in the legend; a phone width must not scroll sideways.
