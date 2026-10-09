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
`scene3d`, `lottie`, `group`); each has a table of known properties with ranges, and anything else is dropped and reported. Nothing in a file
is executed, so opening a file from anywhere is as safe as opening any other livrable. `describeComponents()` lists the
components for the agent's tool description, generated from the same tables.

## 3D, characters, particles, sound

- **Particles** and **path morphs** are expanded to plain primitives by the engine, deterministically (a seeded generator), so a
  frame is the same in the preview, in the export and in the PNG the agent asks for.
- **`scene3d`** is a 3D window (three.js): shapes (box, sphere, cylinder, cone, torus, plane, ring, knot, capsule) and glTF
  models, a camera that can orbit, lights. Every pose, the camera and a model's clip time are resolved by the engine; the renderer
  (`render-ext.mjs`) only applies them. A model's animation clip is set with `AnimationMixer.setTime`, never with a clock.
- **`lottie`** plays a Lottie file frame by frame (`goToAndStop`), for characters made in a Lottie editor. It uses lottie-web's
  `lottie_light_canvas` build, which has **no expression engine**: expressions are code stored in a file, and a scene file may
  not carry code. The tool reports a file that uses them.
- Files (images, sounds, `.glb`, Lottie `.json`) must be inside the project. The host serves a file next to the scene only when it
  is an allowed type and, for `.json`, only when it really is a Lottie file. After every write the tool says whether each file was
  found, a model's animation clip names (use one as `clip`) and a Lottie's length (`assets`, `assets_problems`).
- three.js and lottie-web are **not in `client.js`**: the host serves them at `/kybernos-motion/vendor/three.js` and
  `/kybernos-motion/vendor/lottie.js`, fetched only when a scene has such a layer. They live in private globals
  (`KbMotionThree`, `KbMotionLottie`) so they never replace another bundle's. Card thumbnails skip 3D (one WebGL context per card
  would run out); everything else shows it.
- **Sound**: tracks in the scene (`audio`), played with Web Audio in step with the playhead. Sources: files of the project and
  built-in effects synthesised by `audio.mjs` (whoosh, click, pop, ding, hit, riser, tick: no file, no licence). `mix()` is pure and
  is used for both the preview and the MP4 (AAC, or Opus in WebM).

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
| `render-ext.mjs` | client | The 3D and Lottie renderers, which draw into their own canvas and `drawImage` it onto the frame (tested with fake libraries). |
| `assets-info.mjs` | host | Reads a `.glb` (animation names and lengths) and a Lottie (length, size, expressions) for the agent. Pure. |
| `motion-host.mjs` | host | Scene files, revisions, listing, assets, frame requests, the agent's tool. No `ctx`: everything is injected. |
| `index.js` | host | Wires DSH services: tool `creer_motion` and the routes `/kybernos-motion/*`. |
| `src/plugin.js` | client | The player and the panel. |
| `client.js` | client | **Generated** by `scripts/build.mjs` from `src/plugin.js`, the four pure modules and the vendored Mediabunny. |

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
  `restore`, `asset`, `frame`, `export`, and the two fixed library files `vendor/three.js`, `vendor/lottie.js`.

## Vendored libraries

[Mediabunny](https://mediabunny.dev/) 1.61.3 (MPL-2.0, writes MP4 and WebM), three.js 0.186.1 (MIT) and lottie-web 5.13.0 (MIT):
see `vendor/NOTICES.md` for what each does, how it is included and where its licence is. Rebuild with
`DSH_MOTION_DEPS=<folder> node scripts/vendor.mjs`, then `node scripts/build.mjs`.

## Tests

```bash
cd packages/kybernos-motion
node test-engine.mjs && node test-audio.mjs && node test-render.mjs && node test-render-ext.mjs && node test-assets-info.mjs
node test-motion-host.mjs && node test-host.mjs && node test-client.mjs
node scripts/build.mjs --check
```

Real pixels, a real MP4 decoded by ffmpeg, the Livrables page, 3D with WebGL, a glTF clip and a Lottie, in a real Chrome against a
sandbox DSH: `source scripts/sandbox/env.sh && node scripts/check-motion-live.mjs` (see `docs/dev/live-testing.md`).
