# kybernos-slides

**From the DSH chat, the agent writes a slide deck in REAL TIME in the right
sidebar; the user edits live (text, brush); the agent reads those edits back
and corrects: every corrected passage is underlined on screen.**

```
chat (tool `creer_slides`) ──▶ host ──▶ “Slides” panel (typewriter typing)
panel ──(POST /kybernos-slides/push)──▶ host ──▶ the agent reads back (call WITHOUT `slides`)
```

## What it does

| Half | File | Role |
|---|---|---|
| Host | `index.js` | The `creer_slides` tool + two routes. Holds the **deck** (one command per session) AND the **annotations** (text edits + strokes): a correction keeps the annotations, `effacer_annotations` clears the strokes (the text edits stay). Draws nothing. |
| Client | `client.js` | Panel: typing engine (weight per slide, ordered segments, caret), layouts (`titre`, `statement`, `puces`, `chiffre`, `citation`, `fin`), themes (`sombre`, `clair`, `corail`, `papier`), editing through an overlaid textarea, brush/eraser on a 1600×900 canvas, underlined correction diff, thumbnails, replay. |

The tool's field names and values (`titre`, `sous`, `sombre`, `corriger`…) are
the agent's vocabulary and stay as they are; everything a person reads in the
panel follows the language of the page (French for a French interface, English
for every other language). `client.js` is generated from `src/plugin.js` by
`node scripts/build.mjs`.

The typing is paced by the host's `t0`/`dureeMs` (it catches up; there is no
local replay when a tab opens). The correction diff compares the previous deck
with the corrected one **field by field**: every touched passage gets a green
halo for 5 s, and an `AI · n corrections` badge appears in the header.

## The whole loop (the heart of the work)

1. **The agent writes**: `creer_slides { titre, theme, slides }`; the panel
   types the text character by character, slide after slide.
2. **The user edits live**: **double-click a text** (Google Slides style, or the
   `✎ Text` tool), a **colour** palette above the edit box (the two float next to
   the field, never over the tool bar), `✎ Brush` (coloured strokes), `Eraser`. Every
   edit (text, colour or stroke) is pushed to the host at once. The bar under the
   thumbnails is the transport of the other playback panels (Start / Play-Pause /
   End, 0.5× 1× 2× 4×, `NN%` then `Done`, `n / total slides` above the slider).
3. **The agent reads back**: `creer_slides` **without** `slides` returns the
   current deck plus `annotations.edits` (who changed what, field by field) and the strokes.
4. **The agent corrects**: `creer_slides { mode: "corriger", slides }` with the
   integrated deck; the panel underlines every corrected passage and keeps the
   annotations (`effacer_annotations: true` clears the strokes; the text edits stay).

## Installation

Same recipe as kybernos-modeleur: a symbolic link in
`~/.dsh/profiles/web/node_modules/@local/`, a `link:` dependency and an entry in
`dsh.profile.bundles` of `~/.dsh/profiles/web/package.json`, then a restart of
DSH (the list of bundles is read at start).

## Tests

```bash
node test-host.mjs      # tool, normalisation, annotations, HTTP routes
node test-client.mjs    # typing engine, diff, eraser, panel render, language: no browser needed
```

## Decisions

- **DOM, not canvas, for the text**: inline editing (an overlaid textarea,
  fonts copied to the pixel) and the underlining of corrections come for free;
  the canvas only serves the strokes, a layer above the slide.
- **A 1600×900 scene scaled by `transform`**: the coordinates of the
  strokes and of the layouts are fixed, whatever the size of the panel.
- **The annotations live on the host**: a second tab catches up with the
  edits at load; the agent reads them without a dedicated route (a call without
  `slides`).
- **A correction keeps the annotations by default**: the agent is expected to
  integrate the edits; it only erases the strokes when it asks to.
- **The diff compares field by field, not line by line**: a corrected title is
  underlined whole, which is the level of readability wanted.
