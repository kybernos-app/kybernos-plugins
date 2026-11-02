# Slides as editable HTML: proof of concept

Standalone, not wired into DSH or `packages/kybernos-slides`. See `docs/dev/slides-html-cadrage.md` for the why and the findings.

```bash
cd poc/slides-html
npm install
node check.mjs      # 12 end-to-end checks in headless Chrome, artefacts in out/
npm start           # studio on http://127.0.0.1:47321 (PORT to change it)
```

Needs Google Chrome (set `CHROME_PATH` if it is not in the default macOS location): PDF and PPTX are produced by printing and reading the real page.

| File | Role |
| --- | --- |
| `kit.css` | The only stylesheet a slide may use: 1600x900 scene, three themes, a dozen building blocks |
| `bridge.js` | Runs inside each slide's sandboxed frame: makes text editable, reports edits to the studio |
| `charts.js` | Draws `<canvas data-chart='{...}'>` with Chart.js, so the agent never writes a script |
| `server.mjs` | Deck store, edit log, slide pages with a CSP, PDF and PPTX export |
| `studio.*` | Thumbnails, stage, edit toggle, themes, present mode, "Agent view" |
| `sample-deck.mjs` | A deck as an agent would write it (illustrative numbers) |
| `check.mjs` | The automated check |

Agent loop: `PUT /api/deck` writes the deck, `GET /api/edits` returns what the person changed by hand, `DELETE /api/edits` acknowledges.
