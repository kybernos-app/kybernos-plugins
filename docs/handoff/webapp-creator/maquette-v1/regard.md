# Regard — maquette-v1 (Webapps pane)

Captures: `captures/1-clair.png`, `captures/2-sombre.png`, `captures/3-etroit-480.png`
(reviewed one by one with the vision model; no planche.png — the kit that generates
it, `check-maquette.mjs`, is not on this machine). Local artifacts, not committed:
the repository refuses media in git.

- **vu** — in the first light capture the presentation frame was **wider than its
  scene** (grey on both sides of the 420px pane): the exact "frame wider than its
  content" defect. Also seen: my first dark capture rendered **unstyled** — the
  sed copy lived in `/tmp`, so `dsh.css` no longer resolved; a capture-setup bug,
  not a mockup bug, and the reason a capture must be looked at before it counts.
- **corrigé** — `.mk-frame` is now `width: fit-content; max-width: 100%; margin:
  0 auto` (a window frame hugs its content); the dark capture was redone from a
  file beside its `dsh.css`, then deleted. Re-rendered and re-read: the frame now
  hugs the pane in both themes.
- **laissé** — the Start button inverts to light-on-dark in dark mode (token-driven,
  it is what the product primitives do); the white space below the frame is the
  capture window being taller than the page, not a page defect; the row's stacked
  tag/slug/counts at pane width reads fine; the tab strip, create form and publish
  dialog stay out of scope (see `cadrage.md` `hors-champ`). Font sizes: `dsh.css`
  exports no font-size tokens, so the page bridges the product scale with named
  fallbacks (`--wc-fs-*`, 24px written once) — documented in the page itself.

Verified before the eye: `dsh.css` is byte-identical to the reference example
(`cmp`), and `index.html` contains no hex or rgb colour (grep: 0).
