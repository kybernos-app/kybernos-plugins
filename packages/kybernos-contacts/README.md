# kybernos-contacts

The people and companies of your work, with the kinds and fields a theme defines (the page arrives in a later release).

This release is the **frame** of the plugin: it owns the data point `kybernos/contacts#schema` (what a theme may tell Contacts about its words, fields and stages),
validates a theme's contribution (`contacts-schema.mjs`, pure and bounded), and tells the registry about the point at boot. It has no page, no route and no
agent tool yet: those arrive with the next lots, on top of the shared business base (`docs/dev/business-base.md`).

| | |
|---|---|
| Point | `kybernos/contacts#schema` 1.0, data, inert, at most 4 files per theme |
| Validator | `contacts-schema.mjs` (`node packages/kybernos-contacts/test-contacts.mjs`) |
| Checked by | `node scripts/plugin-check.mjs <theme folder>` (a `point.schema` line per contribution) |
| Switched on by | the Suite, or a theme that extends the point |
| Stores | nothing yet; the data will live in `<DSH home>/kybernos/business/donnees.sqlite` |
