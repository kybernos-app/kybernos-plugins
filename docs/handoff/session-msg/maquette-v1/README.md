# Plate v1 — the two cards, real CSS

`index.html` + `cards.css` — light and dark, the received-message card (collapsed and unfolded, with the report-back
line), the proposal card with its read-only environment, the send dialog, and the same cards at 390 px.

Render it (a headless Chrome is enough; the PNG is **not** committed, media are not committed in this repository):

```bash
cd docs/handoff/session-msg/maquette-v1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1500,1300 --screenshot=/tmp/session-msg-maquette.png \
  "file://$PWD/index.html"
```

Then open `/tmp/session-msg-maquette.png`. `regard.md` records what the review saw and fixed.

The tokens in `index.html` are DSH's own values (Light measured on the live GUI 2026-10-20, Dark read from the engine's
dark block); `cards.css` is the same file the bundle ships, so a change on the plate is a change in the product.
