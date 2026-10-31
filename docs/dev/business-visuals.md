# Business pages: the product's bar and the pictures of a template's database

What the page of a table (`kybernos-db`, « Tables ») shares with the core so it looks like the rest of the product, and how a sector template brings pictures. Everything is drawn or served locally, with one exception: the
Map view fetches its map tiles from OpenFreeMap (see `packages/kybernos-db/README.md`, « Map »).

There is no « active template » any more: several sector templates can be installed side by side, each one is a database of its own (the picker of the Tables page), and the Business group of the menu holds two rows,
Tables and Overview (`docs/dev/business-menu.md`).

## The product's bar

The core hands every business page `props.toolbar = { KbToolbar, useToolbarState }` (`kbBizToolbar` in `packages/kybernos-plugin/client.js`). A page draws the bar in its header row, to the right of the title (`kb6-headrow`): search, favourites star, a view switch with the names beside the icons (`viewLabels: true`), the filter and sort menu, then its primary action as `trailing`. The state comes from `useToolbarState('<page id>', defaults)` (kept in this browser, per page). Without the toolbar (a test, an older core) a page draws a plain bar of its own with the same pieces. `KbToolbar` knows the views `cards`, `list`, `calendar`, `columns` and `map`.

## Pictures

A template's sample rows name their pictures in a field of type `attachment`: `{ "photo": "<template dir>/<name>" }` in `demo/db-sample.json`, a plain JPEG the template ships at `themes/<dir>/demo/photos/<name>.jpg`
(found by id, never by path: `photoFile` in `themes-shipped.mjs`). At install the host hands the engine a `photo` port that reads the file; `kybernos-db` stores it as the row's own file (`instantiate.mjs`), served from
then on by the Tables routes like any file the person attaches, so removing the template never takes a picture away. A picture that does not load leaves the card's placeholder.

**Photographs and portraits.** A theme's sample pictures are its item photographs (1280 px wide, never enlarged from less) and the portraits of its sample people (640 px square, from a 1024 px image). Each is made on its own by `scripts/theme-photos.mjs`: one FLUX 2 call on DeepInfra per picture (the model takes 1920 px at most on a side; about one cent a picture), asked at least as big as the JPEG that is kept, so nothing is ever enlarged. A plan per theme and kind (`docs/dev/theme-photos/<theme dir>-photos.json`, `-portraits.json`) is the recipe: the style, the size asked, the weight kept and, per picture, its prompt and seed (bump the seed to redo one). The model's own JPEG is kept as it is when it fits the weight; otherwise it is re-encoded. The raw answers stay in `~/kybernos-archive/theme-photos/<plan>/`, out of git. The key is read from `DEEPINFRA_API_KEY` or from the DSH credentials file and is never printed. Per AGENTS rule 4 a theme carries 24 such JPEGs at most (photographs and portraits together), each at most 1280 px wide and 220 KB; the guard (`scripts/garde-depot.mjs`) reads the width from the JPEG itself.

So that people and properties fit in 24, a portrait serves two people at most (a pair that never sit together: another table, the far end of the list) and a photograph serves two related items at most (a flat to let and a flat for sale, two townhouses) and never two that sit on the same board; `scripts/test-shipped-themes.mjs` holds both limits.

**People.** A contact table declares an `attachment` field for its portrait (`{ "key": "photo", "type": "attachment" }` in the template's `db/<id>.json`), and the sample rows of that table name them with the scheme above. The cards
view draws the first picture of the field as the cover.
