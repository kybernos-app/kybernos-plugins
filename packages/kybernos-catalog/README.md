# kybernos-catalog

What you sell, rent or recruit for, with the fields and statuses a theme defines (the page arrives in a later release).

This release is the **frame** of the plugin: it owns the data point `kybernos/catalog#type` (what a theme may tell Catalog about its words, fields and stages),
validates a theme's contribution (`catalog-type.mjs`, pure and bounded), and tells the registry about the point at boot. It has no page, no route and no
agent tool yet: those arrive with the next lots, on top of the shared business base (`docs/dev/business-base.md`).

| | |
|---|---|
| Point | `kybernos/catalog#type` 1.0, data, inert, at most 12 files per theme |
| Validator | `catalog-type.mjs` (`node packages/kybernos-catalog/test-catalog.mjs`) |
| Checked by | `node scripts/plugin-check.mjs <theme folder>` (a `point.type` line per contribution) |
| Switched on by | the Suite, or a theme that extends the point |
| Stores | nothing yet; the data will live in `<DSH home>/kybernos/business/donnees.sqlite` |
