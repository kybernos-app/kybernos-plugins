# Slides as editable HTML: cadrage and PoC (2026-11-02)

Status: PoC built and checked, not merged into `kybernos-slides`. Code in `poc/slides-html/`.
Owner verdict after trying it: too basic to use (text-only editing). The free-options study (`docs/dev/office-stack-free-options-2026-11-02.md`) replaces the "build it ourselves" path with a recommendation; this PoC stays as the agent/edit-loop reference.

## Goal

The agent writes a deck as one HTML page per slide. The person edits the text in place, in the same view. The agent reads those edits back and keeps going. PDF is the primary export, PPTX is best effort. This is the approach Manus uses for slides (an in-house HTML studio), without a paid office suite.

## What changes for the person

- Slides look designed (themes, charts, tables) instead of six text layouts.
- Click "Edit text", click any text on a slide, type. No separate editor to learn.
- Download PDF, or PPTX to open in PowerPoint.
- The agent sees what was changed by hand and does not overwrite it.

## Model

A slide is an HTML fragment (`<section class="slide">`) written against a fixed kit stylesheet (1600x900 scene, themes `dark`, `paper`, `light` switched by CSS variables). A deck is `{ title, theme, slides: [{ html, notes }] }`. Charts are declared as data (`<canvas data-chart='{...}'>`) and drawn by the kit, so the agent writes no script.

## Edit loop

Each slide runs in `<iframe sandbox="allow-scripts">` (opaque origin). A small bridge inside tags the text leaves, makes them `contenteditable="plaintext-only"` on request and posts `{ slide, id, before, after, html }` to the studio. The server coalesces edits per slide and text, rewrites the slide HTML, and exposes the list to the agent (`GET /api/edits`), which acknowledges with `DELETE`. When the agent rewrites the deck, the studio flags the changed slides.

## Tool contract v2 (proposal for `creer_slides`)

- `write` a whole deck, or `patch` one slide by index.
- `read_edits` returns the person's edits since the last read.
- Same session-scoped store as today; the 6 text layouts are dropped.

## Exports

- PDF: headless Chrome, `page.pdf` at 1600x900, one page per slide. Measured: 7 slides, 276 KB, 1.5 s.
- PPTX: `dom-to-pptx` run in headless Chrome. Measured: 7 slides, 7 notes, 307 KB, 1 s. Text, tables and bullets are native and editable; charts and gradient blocks become pictures. The first CSS font name is the one exported, so the kit starts with Arial.

## Security

Agent HTML never shares an origin with the studio. Slide pages are served with `default-src 'none'; script-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'`. The server also strips script, iframe, inline handlers and `javascript:` URLs (defence in depth only). Checked: a slide cannot read the parent document nor call the API.

## Checked (12 automated checks, real Chrome)

Agent write, studio load, sandbox fences, in-place edit with before/after, edit saved without editor artefacts, agent correction flagged in the studio, chart drawn inside the sandbox, hostile HTML neutralised, PDF page count, PPTX slide count. Also clicked by hand through themes, present mode, agent view, keyboard and prev/next navigation, empty deck, phone width.

## Not checked

- PPTX opened in real PowerPoint, Keynote or Google Slides (only rendered with `officecli`, which does not draw bullets, so bullets were checked in the XML).
- The in-app browser pane: it blocks the sub-frames (`ERR_BLOCKED_BY_CLIENT`), so the studio view was checked in desktop Chrome.
- Inside DSH: the PoC is standalone, no plugin routes, no session store, no client slot.
- Long decks (cap is 40 slides, 60 KB per slide), images, custom fonts.

## Decisions for the owner

1. Replace the six text layouts with the HTML kit.
2. Accept PPTX as best effort (charts as pictures).
3. Export needs Chrome: use the one in the desktop app, or the machine's Chrome, or a download on first export.

## Next steps

1. Wire the PoC into `packages/kybernos-slides` (routes, tool v2, client slot, try/catch guards).
2. Sheets, docs and PDF: see `docs/dev/office-stack-free-options-2026-11-02.md` (verdicts per format, spikes, order of work).
