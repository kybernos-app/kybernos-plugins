# Field illustrations: the style of the domain covers

> **Status 2026-10-29 (late): the choice below is on hold.** The person asked for the field cards to sit in the
> *existing* skills family (isometric ink-and-watercolour diorama) with one small differentiation, then sent four
> other reference languages (flat app vector, warm gradient flat, soft digital painting, warm interior photograph).
> Two boards were made: `<DSH home>/kybernos/domain-styles/harmony-board-1.png` (six small variations of the skills
> language: no people, red thread, round plinth, one person, tighter world) and `refs-board-1.png` (the four
> reference languages plus a grain-duotone bridge). The riso direction recorded here is **not** the retained one
> yet; keep this page as the measured pipeline and the traps, not as a decision.
>
> **Then, same evening: the person retained the warm architectural photograph** (column D of `refs-board-1.png`)
> as the base, asking for a wide landscape format, more detail and people in the frame. `photo-board-6x4.png`
> tests six photographic recipes (daylight editorial, backlit documentary, overhead flat-lay, high-key airy,
> evening lamplight, tight close-up) over four fields. Only the recipe A (35 mm, f/4, afternoon window light)
> is a candidate for a series of eight; a photograph cannot be cut out, so a field card becomes a photo card
> with a text scrim, not the cut-out tile the skills covers use.
>
> **Retained: recipe A (warm editorial interior photograph).** The person then asked for a palette of twenty
> fields with a cast that varies by trade (one person alone, a pair, a team of three). That palette is
> `<DSH home>/kybernos/domain-styles/palette-20-fields.png`, indexed field by field in `palette-20-fields.json`
> (id, label, cast, scene) next to it. Measured on it: the cast count holds in 19 cells out of 20 (consulting
> came out with four people instead of three); the field names the model prints above the cells are readable
> and wanted here, unlike on a production card. Recipe A is what a field card uses from now on; the riso
> section below stays as the record of the earlier direction.

We need **one illustration per field of work** for the sector templates (the domain packs of `docs/dev/domain-packs.md`).
This page is the decision, the recipe that reproduces it, and the traps measured on the way. Decided on 2026-10-29
after five style boards (eighteen directions) and fifteen image calls (about 2.1 USD, DeepInfra).

The pictures are **not in git** (AGENTS rule 4). They live in `<DSH home>/kybernos/domain-styles/`: the boards,
the retained finals in `domains-final/<id>.png` (1344 × 768), and the generation scripts (one per board, the
style string inside) in `prompts/`.

## The choice: Riso ligne claire, series print

Why this one, out of the eighteen directions tested in five boards:

- **Different from the skills covers**, which are 3D isometric watercolour with ink hatching. Two dimensions and
  two inks against three dimensions and watercolour: no confusion at a glance between a skill card and a field card.
- **Readable at 120 px** — measured, not assumed: the eight finals were downscaled to 120 px and read; the subject is
  still obvious (the trade-off being that any style carrying its identity in texture — clay fingerprints, macro dust,
  gouache brush strokes — turns into a generic CG blur at that size).
- **The red is structural, not decorative**: it holds a series together without a second palette.
- It is cheap to reproduce: one call, one recipe, no post-processing required.

Rejected, with the reason each one gave on the boards: **clay / matte 3D** (texture dies at thumbnail size, and the
wanted "more real" is paid for in legibility), **cinematic 3D characters** (drifts to animation-advertising stock),
**photographic collage** (unreadable at card size, uncanny mix), **gouache painting** (faces and hands are the weak
spot), **flat vector characters** (correct but reads as generic SaaS illustration), **macro still-life** (the field
stops being recognisable: a medical practice becomes a desk), **Bauhaus abstraction** (the model keeps object hints
instead of pure geometry, and the field is no longer readable), **pixel art** (charming, not professional at 350 px),
**paper-cut gouache** and **ink-and-watercolour** (the second is our own skills language, so zero differentiation).

## The recipe

Style string, verbatim (it is the whole look; keep it stable to regenerate a field later):

```
STYLE - RISO LIGNE CLAIRE SERIES PRINT: a 1950s two-ink screen print. Front elevation view, objects standing
on a thin horizon line, one flat dark ground shadow under the group. Medium-heavy near-black ink outline around
every shape. Flat duotone fills of Kybernos red (#f2372a) and near-black ink (#1c1b1a) on a warm off-white paper
ground, coarse 45-degree halftone dots inside the red areas only, subtle paper grain. Strong simplified graphic
silhouettes. No gradients, no shading, no photographic texture, no frame, no border.
```

Call: `POST https://api.deepinfra.com/v1/openai/images/generations`, `model: google/gemini-3-pro-image`,
`size: 1344x768`, `response_format: b64_json`, key `DEEPINFRA_API_KEY` from the DSH credentials store
(the same key as the skills covers, `packages/kybernos-skills/cover-maker.mjs` resolves it the same way).
About 22 s and 0.14 USD an image. `size` above 1344 × 768 is silently ignored by this gateway: asked 2048 × 1152,
got 1408 × 768.

Prompt shape, four blocks, in this order — the bans last:

1. one line of intent (`ONE illustration for a business-field card, landscape format, warm and confident`);
2. the style string;
3. `SUBJECT:` one scene, objects only, no people;
4. `COMPOSITION:` two thirds of the frame, centred, generous paper margin, red at most one third of the surface,
   readable as a 120 pixel thumbnail — then the bans: no text, letters, numbers, logos, watermark, signature,
   handwriting, scribbles, captions, frame.

## The eight scenes

Each scene stays in this file so a field can be made again word for word.

| id | Field | Scene |
|---|---|---|
| `e-commerce` | E-commerce | a wide shop counter seen from the front, a card terminal standing on the top, three closed parcels stacked on the right end, a shopping cart at the left |
| `consultant` | Consultant | a meeting table with two facing chairs, a wall board with three rising bars behind it |
| `coach` | Coach | two low armchairs facing each other, a potted plant between them and three steps climbing at the left |
| `hr` | HR | an open folder holding profile cards, an organisation chart of linked tags hanging above it |
| `immobilier` | Real Estate | a simple house seen from the front with a pitched roof, a medium key standing at its left, a rolled floor plan leaning at its right |
| `artisan` | Artisan | a workbench seen from the front with a handsaw, a plane tool, a glue pot and a clamped wooden plank |
| `ssii` | SSII | a server rack seen from the front, a monitor beside it showing abstract code blocks, a cloud node floating above |
| `cabinet-medical` | Medical practice | an examination table with a coiled stethoscope resting on it, a small drawer cabinet on the left, a potted plant on the right |

## What was measured on the way

- **A style board is a decision tool, never a deliverable.** One call with 8 to 40 cells is enough to choose a
  language, and it is the cheapest way to compare eleven of them. But the cells come out at 176 to 350 px, and the
  model does not hold one framing across cells. The retained finals were made **one call per field**: the boards
  showed a three-quarter view, the finals a front elevation — a better grammar, found by accident on the first
  production call, then made the standard for the other seven.
- **The model writes things nobody asked for.** On the boards it invented the row names and the field names, and put
  them inside the picture; in the ink-and-watercolour direction it added a fake signature. Every prompt repeats the
  bans per call, and the whole image is read with `read_image` before it is kept.
- **Margins matter more than the model.** With less than 40 px of margin the side captions are clipped by the edge.
  On a production card the margin is inside the picture, so it is part of the composition rule.
- **The red share is the readability setting.** Two fields failed the 120 px test on the first pass (`e-commerce`,
  `immobilier`) because the red mass swallowed the silhouette; both were regenerated with the subject declared as
  "the largest object" and the red moved to a secondary element. Two extra calls, both kept.
- **Grids do not survive**: a 6 × 2 board came out with a per-cell frame the prompt never asked for. Fine for a
  board, not for a card.

## Next

- The eight fields above are the ones the person asked for; the packs `droit`, `education`, `finance`, `marketing`,
  `recrutement`, `developpement` and the catch-all still need a card (seven calls, same recipe).
- Serving them in the product is a plugin job, not a copy: the wizard draws a field by its `icon`
  (`docs/dev/domain-packs.md`), so a card needs a route that serves the file and a fallback to the drawn icon when
  it is missing — the shape `GET /kybernos-skills/cover/<id>` already proves.
