# Skills · Featured: how the covers are made

The 24 covers of the Featured tab are **one transparent cut-out per skill**. The screen composes everything else in CSS (the category tint or the
plain card surface, the crop, the title). They are not in the repository (AGENTS rule 4): each one is `<id>.webp` in
`<DSH home>/kybernos/skills-featured/`, which the host serves at `GET /kybernos-skills/cover/<id>`. A pick without its file draws a tile.

## Pipeline (2026-10-15)

1. **Generate**, one image per pick, on a plain white ground.
   - Model: `black-forest-labs/FLUX-2-pro` on DeepInfra, `POST https://api.deepinfra.com/v1/openai/images/generations`, `size: 1344x768`,
     `response_format: b64_json`. About 12 s and 0.015 USD an image.
   - Prompt: `<scene>. <style>. <tail>` (below).
2. **Cut out** with `Bria/remove_background` (RMBG 2.0, trained on licensed data) on DeepInfra,
   `POST https://api.deepinfra.com/v1/inference/Bria/remove_background` with `{ image: <data URL> }`, 0.018 USD. The answer carries
   `images[0]` as a data URL **or** as a temporary https URL: handle both. Keep the source image and retry only the failing step.
3. **Trim and convert**: crop to the alpha bounding box (alpha above 10) with 3 percent of the longer side as padding, resize to at most
   900 px wide, save as WebP at quality 88 (about 100 to 170 KB each, 3 MB for the 24).
4. Copy the files into `<DSH home>/kybernos/skills-featured/`.

The key is the one DSH holds for DeepInfra (`DEEPINFRA_API_KEY` in its credentials store). It is never printed or committed.

## Style sheet

- Style: `Isometric miniature world as a soft matte 3D render, but rich in hand-drawn detail like an ink-and-watercolour illustration: many tiny props and micro-details, a fine hand-inked line and hatching texture applied on the surfaces, watercolour wash texture and subtle bleeding colour on the materials, small plants, cables, scattered papers and tiny scribbles that are not letters, tiny characters with expressive faces, warm soft light, pastel palette with ochre and sage`
- Tail: `The tile floats alone, isolated on a perfectly plain pure white background, nothing else in the frame, no shadow cast on the background, centred with a generous margin all around. No text, no letters, no numbers, no words, no logos, no watermark, no signature.`

## Scene per pick

| Pick | Scene |
|---|---|
| `pdf` | a machine that turns a heap of loose papers into neat stamped documents: tiny people feed sheets into a hopper at one end and carry out a tidy stack with a red stamp at the other end |
| `docx` | people writing and editing a long document in a workshop: a giant page on an easel with tracked changes shown as coloured flags, tiny people with pencils and rulers adjusting a table, a stack of styled pages |
| `pptx` | a small theatre stage where tiny people assemble a slide deck: large slides on easels showing simple shapes such as a pie chart and a title bar, someone presenting with a pointer, a stack of slides being sorted |
| `xlsx` | a team turning a heap of scribbled notes into a tidy table: a large grid sheet spread out like a field, tiny people stacking coloured blocks into columns, one of them watering a bar chart that grows like a plant, no readable numbers anywhere |
| `data-visualization` | tiny gardeners tending a chart garden: bar charts growing like plants, a line chart as a winding path, a pie chart as a round pond, people with watering cans and measuring tapes, no readable numbers |
| `sql-queries` | a library of cylindrical database towers connected by pipes, tiny librarians pulling a glowing scroll through a tube, tables sorted on a conveyor, a magnifier checking a result |
| `frontend-design` | designers assembling a user interface like a physical model: a large browser window being built, one painting a colour palette, another aligning a layout grid with a ruler, a button being placed, a wireframe sketch on a table |
| `canvas-design` | a giant canvas on an easel in an art studio with tiny painters on scaffolding painting abstract shapes, paint pots and brushes, a poster coming out of a small printing press |
| `design-taste-frontend` | tiny art directors curating a moodboard wall: pinned photographs and colour swatches, type specimens, a person choosing between three website layouts laid on a table, a magnifying glass over a detail |
| `algorithmic-art` | an art studio where tiny people tend a big plotter machine that draws flowing algorithmic patterns, a wall of generated variations, dials and sliders, a seed packet being planted into the machine |
| `baoyu-diagram` | a whiteboard wall where tiny people sketch a diagram of boxes and arrows by hand, connecting boxes with ropes and arrows, ladders and sticky notes, a person stepping back to look, hand-drawn style shapes |
| `slack-gif-creator` | tiny animators flipping a thick flipbook, a loop arrow made of film frames, a smiley character jumping across the frames, a small party scene with confetti |
| `firecrawl-deep-research` | explorers with lanterns descending a deep library well made of stacked books, collecting glowing pages, a large report being assembled at the bottom with bookmarks, ropes and pulleys |
| `tavily-research` | researchers at a giant globe and a map table, tiny people pinning sources with thread, one looking through a telescope, a report being stamped |
| `firecrawl-competitive-intel` | two small rival market stalls side by side, tiny people comparing their signs with a balance scale in the middle, a clipboard comparing features, a spyglass |
| `seo-audit` | tiny inspectors with magnifying glasses and ladders examining a giant web page as if it were a landmark, one climbing a tall ladder to fix a signpost at the top, a golden star placed at the very top of a ranked list of results |
| `copywriting` | a writer workshop: a giant typewriter with paper rolling out, tiny people editing lines with huge pencils and erasers, a megaphone, a headline being carved like a signboard |
| `cold-email` | a postal sorting room where paper planes made from letters take off from a big mailbox, a conveyor belt of envelopes, a few recipients catching planes and sending reply arrows back |
| `gws-gmail-triage` | an overflowing inbox of envelopes being sorted by tiny people into three coloured trays, a calm person at the centre holding a checklist, the pile getting smaller |
| `gws-workflow-meeting-prep` | a meeting room being prepared: tiny people setting a long table, arranging chairs, placing agendas and documents, a wall calendar and a clock, a coffee machine |
| `task-management` | a big checklist board with tiny people ticking items, moving sticky notes between columns, a calendar with a pin, a clock |
| `grill-me` | one small person sitting alone on a stool under a single hanging lamp, surrounded by oversized question marks, while a few tiny figures with magnifying glasses and notebooks inspect their plan, a large sheet of paper unfolded on the floor |
| `systematic-debugging` | a team tracing a bug: a large insect under a giant microscope, a tangle of cables being untangled, a board of clues linked with red string, a light bulb above |
| `mcp-builder` | tiny engineers building a connector between two machines, plugging a big cable plug into a socket, toolboxes, blueprints on a table, a bridge of pipes |

## Made on the fly

The same pipeline now runs inside the plugin for a card that has no picture (`cover-maker.mjs`, `docs/dev/learned-skills.md`): `COVER_STYLE`, `COVER_TAIL` and the example
scenes are the strings of this document, verbatim (`test-cover-maker.mjs` reads this file and fails when they drift), so a picture made later looks like the shipped ones.
Measured on a real run: scene 2.5 s, picture 14 s, cut-out 2.5 s. Bria's answer is `images[0]` as an https address on `temp.bria.ai`, not on DeepInfra. The made
pictures are not in the repository (no media in git): they live in `<DSH home>/kybernos/skills-featured/`.

## Rules and open points

- A skill is featured only if **no skills.sh audit provider says `fail`** (`test-picks.mjs` guards it) and only if the host's own install
  route installs it: all 24 were installed with `installSkill` on a throw-away home. Three candidates were dropped for that second reason
  (the `heygen-com/hyperframes` archive is 506 MB, above the 96 MiB cap; `competitive-brief` exists twice in its repository; the
  `github/awesome-copilot` archive is too large too).
- Licence terms of FLUX.2 pro through DeepInfra and of Bria RMBG 2.0 for the shipped images are **to be confirmed** before the covers are
  distributed.
- `packages/kybernos-skills/generer-pochettes.mjs` is the previous, manual generator (its provider's keys were rejected with HTTP 401 on
  2026-10-15). It is kept until this pipeline is a committed script; it is not used for the picks.
## Distribution

The covers reach other machines through the relay (`services/skills-index`, route `GET /v1/covers/<id>.webp`).

1. `node scripts/prepare-covers.mjs --write-picks` checks the 24 files, writes each SHA-256 into `featured-picks.json` (`coverSha256`) and copies
   the pictures to `services/skills-index/covers/` (ignored by git).
2. Deploying the relay (`vercel deploy --prod` from `services/skills-index`) publishes them: a public endpoint, done on purpose.
3. A plugin whose covers folder lacks a pick's file fetches it once from the relay in use, checks the hash, and keeps it. A relay that does not
   have it, is down, or serves something else leaves the tile; nothing is retried for ten minutes.

Changing a picture = a new file, a new hash in the picks file, a plugin release (the hash is part of the signed archive).
