# kybernos-pipeline

Orders, deals or candidates as cards that move from stage to stage, with the stages a theme defines (the page arrives in a later release).

This release is the **frame** of the plugin: it owns the data point `kybernos/pipeline#flow` (what a theme may tell Pipeline about its words, fields and stages),
validates a theme's contribution (`pipeline-flow.mjs`, pure and bounded), and tells the registry about the point at boot. It has no page, no route and no
agent tool yet: those arrive with the next lots, on top of the shared business base (`docs/dev/business-base.md`).

| | |
|---|---|
| Point | `kybernos/pipeline#flow` 1.0, data, inert, at most 4 files per theme |
| Validator | `pipeline-flow.mjs` (`node packages/kybernos-pipeline/test-pipeline.mjs`) |
| Checked by | `node scripts/plugin-check.mjs <theme folder>` (a `point.flow` line per contribution) |
| Switched on by | the Suite, or a theme that extends the point |
| Stores | nothing yet; the data will live in `<DSH home>/kybernos/business/donnees.sqlite` |
