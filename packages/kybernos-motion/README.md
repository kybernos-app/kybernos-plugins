# kybernos-motion

Motion design driven by the chat. The agent writes an animation as data; a panel in the right sidebar plays it, lets the
user change its settings, and exports it as an MP4 video, a standalone page or a Mac app.

## What the user sees

- Ask the chat for an animation. The **Motion** tab opens by itself in the right sidebar.
- Play it, drag the cursor on the timeline, change the scene's settings (text, colours, numbers). Every change is saved
  as a new revision and the agent sees it the next time it reads the scene.
- **Export**: MP4 (H.264 + AAC, WebM when the browser cannot write H.264), a standalone `.html` page, the scene file, or a
  Mac app (macOS only, through `kybernos-miniapps`). Video is encoded in the browser; nothing leaves the machine.
- The animation is a `<name>.miniapp.json` file in the project's `artifacts/` folder, so the **Livrables** page, the chat card
  and the popup open it too (the `motion` player is added through the MiniApp door of the core).

## A scene is data, never code

```json
{ "kind": "motion", "renderer": "motion", "title": "Intro",
  "meta": { "rev": 3, "history": [ { "r": 3, "by": "user", "at": "...", "what": "Titre: Salut" } ] },
  "data": [ { "format": { "width": 1920, "height": 1080, "fps": 30, "duration": 5 },
              "background": "#0f1115", "params": { "titre": "Bonjour" },
              "layers": [ { "type": "text", "text": "{titre}", "size": 120,
                            "alpha": { "k": [[0, 0], [0.6, 1, "out"]] } } ],
              "audio": [ { "synth": "ding", "at": 1 } ] } ] }
```

Every property is a number, a `$param`, or keyframes `{ "k": [[time, value, ease?], ...] }`. Layers are components
written in `engine.mjs` (`rect`, `circle`, `line`, `text`, `number`, `image`, `path`, `morph`, `chart`, `particles`,
`group`); each has a table of known properties with ranges, and anything else is dropped and reported. Nothing in a file
is executed, so opening a file from anywhere is as safe as opening any other livrable. `describeComponents()` lists the
components for the agent's tool description, generated from the same tables.

## Where things live

| What | Where |
|---|---|
| The scene | `<session folder>/artifacts/<name>.miniapp.json` (else `<dsh home>/kybernos/motion/files/`) |
| The last 20 revisions of each scene | `<dsh home>/kybernos/motion/history/` |
| Frames the agent asked to see | `<dsh home>/kybernos/motion/preview/` (PNG, read by the agent with its file tool) |
| Exported videos | next to the scene (`artifacts/<name>.mp4`) |

`<dsh home>` is `DSH_HOME`, else `~/.dsh`. Writes are tmp + rename. Files only go where the core says the session may work
(`globalThis[Symbol.for('kybernos.workspace')]`: the session folder and a resolve-then-compare path check, symlinks included).

## Files

| File | Half | Role |
|---|---|---|
| `engine.mjs` | both | Pure core: validation, easing, params, keyframes, components expanded to primitives, timeline, inspection, compaction. No DOM, no disk. |
| `audio.mjs` | both | Pure sample maths: built-in sound effects (no file, no licence) and the mixer. |
| `render2d.mjs` | client | Paints a frame's primitives on a Canvas 2D context (tested with a recording context). |
| `motion-host.mjs` | host | Scene files, revisions, listing, assets, frame requests, the agent's tool. No `ctx`: everything is injected. |
| `index.js` | host | Wires DSH services: tool `creer_motion` and the routes `/kybernos-motion/*`. |
| `src/plugin.js` | client | The player and the panel. |
| `client.js` | client | **Generated** by `scripts/build.mjs` from `src/plugin.js`, the three pure modules and the vendored Mediabunny. |

## How the agent checks its work

The tool answers every write with what a person would notice on screen: text that leaves the frame, two texts on top of
each other, low contrast, text too small for a phone, text on screen too briefly to be read, layers that never draw
(`inspect()`, approximate by design). `voir` asks the open panel for a PNG of one instant; the agent reads it with its
file-reading tool.

## Seams

- Slots: `sidebar.right.pane.tab` (and the `sidebarRightTabs` registry). No engine patch.
- Core: reads `Symbol.for('kybernos.workspace')` (published by `kybernos-plugin`); registers its player through
  `window.__KB_MINIAPP__.register('motion', ...)`.
- `kybernos-miniapps`: `window.__KB_MINIAPP_EXPORTERS__.motion` gives the installed Mac app a live page instead of a still
  picture; `window.__KB_MINIAPPS__.install` is used by the Export dialog.
- Routes (all origin-guarded, same rule as the other bundles): `state`, `scene`, `save`, `open`, `list`, `revisions`,
  `restore`, `asset`, `frame`, `export`.

## Vendored library

[Mediabunny](https://mediabunny.dev/) 1.61.3 (MPL-2.0) writes the MP4 and WebM files, see `vendor/NOTICES.md`. Rebuild with
`DSH_MOTION_DEPS=<folder> node scripts/vendor.mjs`, then `node scripts/build.mjs`.

## Tests

```bash
cd packages/kybernos-motion
node test-engine.mjs && node test-audio.mjs && node test-render.mjs
node test-motion-host.mjs && node test-host.mjs && node test-client.mjs
node scripts/build.mjs --check
```
