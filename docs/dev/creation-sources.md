# Creation sources

Creations lists files. A plugin that keeps things that are not files (the Dashboards, the Apps) declares a **source**, and the Creations page draws one tile for it (with a count) and one card (or row) per item. The core knows no such plugin by name.

```js
window.__KB_CREATIONS__.register({
  id: 'dashboards',                       // 2–24 lower-case letters, digits or dashes; never the id of a type or family of the core
  label: { en: 'Dashboards', fr: '…' },   // the tile and the badge; `en` is required (en, fr, es, ar)
  desc: { en: '…' },                      // the line under the tiles when this tile alone is selected
  art: 'dashboard',                       // a drawing the tiles already have (KB_NC_ART): dashboard, app, miniapp, sheet, …
  order: 10,                              // -1000…1000, default 100
  foldsRow: 'dashboards',                 // optional: the menu row this source stands in for
  load: async () => [{ id, title, sub, mtimeMs }],   // the items; read again each time the page opens
  open: (item) => {},                     // opens one item in the plugin's own page
  home: () => {},                         // optional: opens the plugin's own page (the way in when there is no item yet)
})                                         // returns the function that takes the source back (call it in the effect's cleanup)
```

- The registry belongs to the core and may not be there yet when a plugin is applied (the order is DSH's): ask again until it is, as the menu registry's users do (`kybernos-db`, `kybernos-dashboards`).
- `foldsRow` keeps the page reachable: the menu row is hidden **only while the source is declared** (a plugin that goes away, or a core without the registry, leaves the row in place). The states the row showed (Kaby's suggestions waiting, a connection to make) show on the Creations row instead.
- The items show only when the tile is selected (« All » keeps the files only; the tiles carry the counts). The search and the « Modified » period apply to them; the favourites filter leaves them out (they cannot be pinned).
- A source that fails to load gives an empty tile; the `home` button is always drawn when the tile is selected, so the page stays reachable with no item.
- Refused entries (unknown key, an id of the core, a drawing the tiles do not have, more than six sources…) are not drawn; one `console.warn` says why. `window.__KB_CREATIONS__.check(entry)` gives the reasons without declaring anything.

Tested by `packages/kybernos-plugin/test-creation-sources.mjs` (the real rules, through `lib-creation-sources-test.mjs`) and by the tests of each plugin that declares a source; checked on the real GUI by `scripts/check-creation-sources-live.mjs`.
