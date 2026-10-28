# Plate v1 — Journal d’activité (Settings ▸ Système)

`index.html` + `kblg.css` — light and dark at the Settings width (720 px), the 390 px column, and the Settings
rail with the System fold. The data is simulated; **the CSS is the bundle's own** (`packages/kybernos-log/client.js`,
`const CSS`), so a change on the plate is a change in the product.

Render it (a headless Chrome is enough; the PNG is **not** committed — media are not committed in this repository):

```bash
cd docs/handoff/journal-activite/maquette-v1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1560,1500 --screenshot=/tmp/journal-maquette.png \
  "file://$PWD/index.html"
```

Then open `/tmp/journal-maquette.png`. `regard.md` records what the review saw and fixed.

## Why no `maquette.json` / `check-maquette.mjs` run

The kit named by the `maquette-dsh` / `feature-plugin-dsh` skills (`scripts/maquette-new.mjs`,
`scripts/check-maquette.mjs`, `scripts/maquette-lib.mjs`) is **not in this checkout**: `node scripts/check-maquette.mjs`
answers `MODULE_NOT_FOUND`. The plate therefore follows the shape of the last one that shipped here
(`docs/handoff/session-msg/maquette-v1`): tokens + the bundle's real CSS + a rendered capture that is read, not
assumed. When the kit comes back, the contract can be added around this folder without touching the page.

## What the plate is for

Judging, before wiring anything into the GUI: the density of the table at 720 px, the legibility of the family
chips, the four cards at the top (two of them count what nobody asked for), and what happens at 390 px.
