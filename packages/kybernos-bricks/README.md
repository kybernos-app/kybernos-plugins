# kybernos-bricks

**The POC: from the DSH chat, a brick mockup is born in the right sidebar —
brick by brick, live, then read back.**

```
DSH chat ──(tool `animer_briques`)──▶ host ──(GET /kybernos-bricks/state)──▶ “Bricks” panel (“Briques” in French)
```

## What it does

| Half | File | Role |
|---|---|---|
| Host | `index.js` | The `animer_briques` tool + two routes. Holds the store (one order per session) and the **laying clock** (`t0`, `dureeMs`). Draws nothing. |
| Client | `client.js` | Right-sidebar panel: isometric Canvas 2D engine, 9 generators, an op executor, a transport (play, speeds, cursor, replay). |

The panel **does not play a local animation**: it lays
`total × (now − t0) / duration` bricks, from the host's clock. A tab that
arrives late catches up instead of replaying from zero.

## The two paths

1. **`prompt`** — "build a lighthouse on rocks". The panel classifies the
   request and picks an archetype: castle, alpine chalet, lighthouse, rocket, robot,
   clock square, mosaic, van, hummingbird.
2. **`ops`** — the agent draws itself. Each batch is laid in the order of the
   array:

```jsonc
[
  { "op": "plate",  "x": 0, "y": 0, "z": 0, "w": 12, "d": 12, "color": "#4C9A52" },
  { "op": "rect",   "x": 2, "y": 2, "z": 1, "w": 8,  "d": 8,  "h": 3, "color": "#9BA3A7" },
  { "op": "disc",   "cx": 6, "cy": 6, "r": 3, "z": 4, "color": "#C4291C" },
  { "op": "cone",   "cx": 6, "cy": 6, "z": 7, "r": 3, "niveaux": 3 },
  { "op": "tree",   "x": 10, "y": 10, "z": 1, "h": 3 }
]
```

Known ops: `rect`/`wall`/`bloc`, `plate`/`dalle`, `disc`/`cylindre`,
`ring`/`anneau`, `cone`, `pyramide`, `arbre`/`tree`, `brique`/`brick`/`point`,
`archetype` (a whole model). An unknown op is ignored, without creating a batch.

Chaining `animer_briques` with `mode: "modifier"` **adds** batches to the
current mockup: that is the "the chat keeps drawing" path, and only the new
batches are animated. The mode takes `ops`: a `prompt` alone adds nothing to an
existing model (the tool's answer says so).

## Installation

The profile must list the package — `dsh.profile.bundles` **and** a `link:`
dependency in `~/.dsh/profiles/web/package.json`, plus the matching symbolic link in
`node_modules/@local/`. A DSH restart is required
(the list of bundles is read at startup):

```bash
ln -s <your checkout>/packages/kybernos-bricks \
      ~/.dsh/profiles/web/node_modules/@local/kybernos-bricks
# then add "@local/kybernos-bricks" to dsh.profile.bundles and restart DSH
```

The panel opens **by itself** when a mockup arrives, and the **Bricks** tab type
stays offered at all times by the selector (the `+`) of the right
sidebar. No button is put in the footer of the sidebar: a permanent
"▦ Bricks" used to sit there for nothing.

## Tests

```bash
node test-host.mjs      # the tool + the routes on a real HTTP server
node test-client.mjs    # engine, ops, rendering, slot wiring — no browser
```

`test-client.mjs` checks in particular, for the 9 archetypes, that none has an island
of detached bricks (a 6-neighbour connectivity test from the ground) — the most
expensive defect of a mockup generator, and the one that only shows to the eye.

## Decisions

- **Canvas 2D, not Three.js.** The flat per-face shading and the sharp edges of the
  "brick" rendering are closer to the reference in 2D than in WebGL, and the
  package has **no dependency**: no CDN, no node_modules.
- **The clock is on the host.** Otherwise two tabs open on the same session
  play two different animations.
- **`t0` + catch-up.** The panel joins the chat's clock; it does not restart
  when it mounts.
- **An in-memory `Map`, no persistence.** A mockup is a show,
  not a document.
