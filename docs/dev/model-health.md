# Model health: the chip on the AI Provider & Models tab

When a study model (`brain`) is set in Kybernos Settings, the configured models are probed on the host (one real,
tiny call each, cached five hours). A model that no longer answers is reported. With no study model nobody is
watching and nothing is shown.

Until now the verdict was a five-line banner drawn by `kybernos-sessions` above the page. It is now a **chip on the
tab bar** of AI Provider & Models, drawn by `kybernos-models`:

- At rest: `⚠ 3 models not answering` (or `No model is answering` when nothing answered at all: a general failure,
  connection or keys, not N guilty models).
- Click: a popover with the title (`3 of 40 models are not answering`), the causes by count, one row per failing
  model with its cause, and three actions.
  - **Fix key** (on key problems only) opens that provider's Edit panel on the Providers tab. A provider that cannot be
    edited here (read-only page, managed route, unknown route) shows its models instead.
  - **Recheck** forces a new probe (it also lifts the silence).
  - **Show them** switches to the Models tab, filtered on *Status · Not answering*; *Reset* clears it.
  - **Hide for 1 hour** hides the chip and stops probing for an hour (`kb-sante-silence` in localStorage, survives a reload).
- Causes: `key` (not accessible with the current key), `gone` (gone from the provider), `refused` (refused by the
  provider), `text` (unable to take a text request), `silent` (no answer), `other`.

## The contract between the two bundles

Neither imports the other. `kybernos-sessions` owns the probe and the state; it draws nothing.

| | |
|---|---|
| `window.__kybernosHealth` | `{ version: 1, get(), recheck(), hide() }`, set while the sessions bundle is mounted |
| `get()` | `null` (nothing to say), or `{ total, tousEnEchec, verifieA, checking, alertes: [{ cle, route, id, code, cause }] }` |
| `kybernos-health` | an event on `window`, fired after every change: read `get()` again |

Either side may be absent: without the chip nothing is drawn, without the bus the chip stays hidden. A test pins that
the cause ids the sessions bundle publishes are exactly the ones the chip has words for.

## Why not draw it in the sessions bundle

The banner was DOM built and anchored on `data-slot="kybernos-models-header"` (a node `kybernos-models` paints), found by
a MutationObserver, and could only open the Models page by clicking through the Settings nav. "Fix key" and "Show them"
are interactions with the Models page's own state (the Edit panel, the filters): they belong to the bundle that owns it.
The observer, the DOM building and the `.kbr-sante*` styles are gone (about 290 lines).

## Tests

- `packages/kybernos-sessions/test-sante.mjs` — the view (pure), the cause map, the bus against a fake window, fetch and
  settings (recheck, double recheck, hide, silence lifted, dispose).
- `packages/kybernos-models/test-client.mjs` — the pure rules of the chip (`KB-HEALTH-PURE`), the cross-bundle contract, wiring.
- On the real GUI, read-only (both clients swapped into the served bundle, the probe's host routes faked so no model
  is called, no write button pressed): the chip's place and size, the popover, *Fix key* (Edit opened then cancelled),
  *Show them*, *Recheck*, *Hide*, and widths 1500 / 1000 / 700 px.
