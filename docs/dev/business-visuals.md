# Business pages: one template at a time, the visual kit, pictures, the map

What Contacts, Catalog and Pipeline share so they look alike and feel alive, which sector template they show (one at a time), and how a template brings pictures and places. Everything is drawn or served locally, with one exception: the Map view of the Catalog fetches its map tiles from OpenFreeMap, and only when that view is opened (below).

## One active template

Several sector templates can be installed side by side (E-commerce, Real estate, Recruitment…). The three Business pages show **one** of them at a time: before this rule,
Catalog drew Products and Properties together, Contacts mixed customers and buyers, Pipeline mixed boards. The other installed templates stay installed and wait until they are picked.

**The scope.** Every row of the shared base (`contact`, `note`, `item`, `flow_card`, schema 2) carries a `scope`: the plugin id of the template it belongs to (`kybernos-themes/ecommerce`),
or `''` when no template was active when it was made. A question to the base is about the **active** template's rows unless it names a scope (`scope: '<id>'`, `'*'` for every one, `''` for the rows
of none); a new row takes the active scope (a note takes its contact's); sample rows take the scope of the theme that seeded them; the scope is not a column anyone can write through a route or a tool.
Nothing is deleted when a template is switched off: its rows stay in the base, dormant, and come back when it is picked again.
*With no active template the pages behave as they always did*: no filter, the default types.

**Unscoped rows.** What the person made while no template was active has no scope. The first template that becomes active **adopts** it (one journal line, at the next question), so typing
three contacts before installing a template does not lose them. A base written before schema 2 is migrated in place (forward only, idempotent, safe while two processes open it): its sample
rows go back to the theme that seeded them, read from the journal of the seeds (`<theme>: N contacts, N items…` after the last `clear-demo`, counted in id order per table; a table that does
not add up to the journal is left unscoped and adopted), and its other rows are adopted by the template active at the next question.

**Which one is active.** One small file beside the base, `<DSH home>/kybernos/business/active-template.json` (`{ v: 1, active, at }`, written whole and renamed, `0600`, one per profile). The stored
choice stands while that template is installed; if it is not (removed, or never chosen), the template installed last (`themes.json`) that is still there, then the first by id; none when none.
**Recording an install makes the new template the active one** (the host does it in the `record` action of `/kybernos/themes`; the page only reads the answer again). A template the registry does
not read yet (waiting for consent or a restart) is stored and takes effect when it is listed.

**What a template feeds.** Nothing new in a template: the selector and the rows read its field-of-work pack (`domains/<id>.json`): `name`, `icon`, `accent` and `menu.labels.contacts|catalog|pipeline`
(`docs/dev/plugin-contract.md`, point `kybernos/core#domain-pack`). The types, boards and schema the pages offer are the **active** template's contributions to `kybernos/catalog#type`,
`kybernos/contacts#schema` and `kybernos/pipeline#flow` (the registry says which plugin each contribution comes from). A template with no word for a row leaves the row its plain word; it never
borrows another template's.

**The route.** `GET /kybernos/business/scope` → `{ ok, ready, active, stored, templates: [{ id, name, icon, accent, words }] }`; `POST { action: 'set', id }` switches (and answers the same view).
Plugin routes are served before DSH's own sign-in, so: a read needs the signed session cookie (and refuses a foreign Origin; a read with no Origin, a direct navigation, is allowed), a switch needs
the cookie and the strict same origin. `ready: false` means the registry has not yet heard the three Business points (the first seconds after DSH starts): the page asks again after 1.2, 3, 7 and
15 s, and the host answers with the stored choice meanwhile instead of « nothing installed ». Code: `business-scope.mjs` (pure), `business-base.mjs` (the scope of every question), the three hosts
(`types`, `schema`, `flows` filtered by the plugin that contributed them).

**The selector.** In the « Business » group, under its header and above its rows, drawn only when **two or more** templates touch the pages (with one, that one is simply the active one; with none,
nothing). A button with the template's icon on a tint of its accent and its name; opened (inline, not over the page) a menu of radio items and one line saying the others stay installed. A real button
(`aria-haspopup`, `aria-expanded`, `aria-checked`), the arrows, Home, End, Enter, Escape (the focus goes back to the button), Tab closes; a switch that the host refuses leaves the menu open with a
line in `role="alert"` and changes nothing; no selector in the icon rail. Switching needs no reload: the three rows take the new template's words, and the page that is open is mounted again under a
new key (`<row>|<template>`), so it loads its own rows, types and boards. On a phone the drawer stays open while the selector is used (`data-kb-keep-open`, read by `kybernos-mobile`).

Checked by `scripts/check-one-template-live.mjs` (sandbox: both templates installed with their samples; every row, chip and board counted against what the base holds; a real mouse, the keyboard,
the refusals, light, dark and 420 px) and by the node tests `test-business-scope.mjs`, `test-business-scope-base.mjs`, `test-business-scope-client.mjs` and the host tests of the three plugins.

## The product's bar

The core hands every business page `props.toolbar = { KbToolbar, useToolbarState }` (`kbBizToolbar` in `packages/kybernos-plugin/client.js`). A page draws the bar in its header row, to the right of the title (`kb6-headrow`): search, favourites star, a view switch with the names beside the icons (`viewLabels: true`), the filter and sort menu, then its primary action as `trailing`. The state comes from `useToolbarState('<page id>', defaults)` (kept in this browser, per page). Without the toolbar (a test, an older core) a page draws a plain bar of its own with the same pieces. `KbToolbar` knows the views `cards`, `list`, `calendar`, `columns` and `map`.

## `window.__KB_BIZ_KIT__`

Published by the core (block `<kb-business-kit>`, test `packages/kybernos-plugin/test-business-kit.mjs`); a page reads it when it renders, never at load, and falls back to plain chips when it is missing.

| | |
|---|---|
| `Tag({ text, hue, dot, icon, on, onClick })` | A coloured chip; the colour follows the text (`tint(text)`), so « pre-approved » is always the same colour. A button only when it is clicked. |
| `Avatar({ name, size, kind, image })` | A person: initials on a gradient, with the picture `image` (`photo:<template dir>/<name>`) laid over them; the initials show while it loads, and stay when it is missing or does not load. `kind: 'company'` is a `Logo`. |
| `Logo({ name, size, seed, image })` | A company mark drawn in code, never a file (see « Company marks »). |
| `photoUrl(ref)` | The address (`/kybernos/themes/photo?id=…`, same origin) of a `photo:` reference, or `null`. |
| `Art({ spec })` | An illustration drawn from a spec `art:<kind>[/<seed>][@<hue>]`. Kinds: house, apartment, villa, loft, shop, box, bottle, bag, desk. Anything else draws nothing. |
| `Icon(name, size)` | The business icons (pin, bed, bath, ruler, tag, euro, leaf, sparkle, cart, truck, cap, clock, key, heart, star, layers, map, grid, list), then the core's own. |
| CSS classes | `kz-lift` (hover lift), `kz-in` with `--kz-i` (staggered entry), `kz-press`, `kz-pop`, `kz-img` (a picture that zooms a little on hover). All stop under `prefers-reduced-motion`. |

## Company marks

`Logo` draws a fictitious brand: the company's name (or `seed`) picks, always the same way, one of twelve geometric glyphs (orbit, stack, peak, quarters, ring, bars, leaf, hex, spark, wave, arch, chevrons) or a monogram (the capitals of the first two words), two quiet hues from the kit's list (`tint` hues, a second one 22 to 42 degrees away) and the avatar's gradient. White shapes with one accent on a 64 by 64 canvas, so it is sharp at any size and reads on a light and a dark page; under 26 px it is always a glyph. Contacts (the company's face in the list, the cards and the panel, and the small mark beside a person's company), Pipeline cards whose contact is a company and a Catalog type that names its company (`card.company`, below) use it. A company row may carry an `image` too (a `photo:` reference): it lies over the mark as a portrait lies over initials; the sample companies use the drawn marks only.

## Pictures

A catalogue type names a text field in `card.image`. Its value is one of:

- `photo:<template dir>/<name>`: a sample picture the template ships at `themes/<dir>/demo/photos/<name>.jpg`, served by the core at `GET /kybernos/themes/photo?id=<dir>/<name>` (same origin, a plain JPEG found by id, never by path: `photoFile` in `themes-shipped.mjs`);
- `art:<kind>/<seed>`: a drawn picture (above).

A photograph that does not load turns into the drawn picture that goes with the type's icon.

**Photographs and portraits.** A theme's sample pictures are its item photographs (1280 px wide, never enlarged from less) and the portraits of its sample people (640 px square, from a 1024 px image). Each is made on its own by `scripts/theme-photos.mjs`: one FLUX 2 call on DeepInfra per picture (the model takes 1920 px at most on a side; about one cent a picture), asked at least as big as the JPEG that is kept, so nothing is ever enlarged. A plan per theme and kind (`docs/dev/theme-photos/<theme dir>-photos.json`, `-portraits.json`) is the recipe: the style, the size asked, the weight kept and, per picture, its prompt and seed (bump the seed to redo one). The model's own JPEG is kept as it is when it fits the weight; otherwise it is re-encoded. The raw answers stay in `~/kybernos-archive/theme-photos/<plan>/`, out of git. The key is read from `DEEPINFRA_API_KEY` or from the DSH credentials file and is never printed. Per AGENTS rule 4 a theme carries 24 such JPEGs at most (photographs and portraits together), each at most 1280 px wide and 220 KB; the guard (`scripts/garde-depot.mjs`) reads the width from the JPEG itself.

So that people and properties fit in 24, a portrait serves two people at most (a pair that never sit together: another type, the far end of the list) and a photograph serves two related items at most (a flat to let and a flat for sale, two townhouses) and never two that sit on the same board; `scripts/test-shipped-themes.mjs` holds both limits.

**People.** A contact names its portrait in a text field `image` that the theme's contacts file declares (`{ "key": "image", "type": "text" }`): the same `photo:<theme dir>/<name>` scheme, served by the same route. The Contacts page draws it as the face (list, cards, panel, edit dialog), the Pipeline host sends it with the card's contact (`contact.image`, a `photo:` reference only, `null` otherwise) and the kit's `Avatar` shows it over the initials. The page never lists that field as a text field and never sends it back: saving a contact keeps its picture. A theme without that field has initials only.

## The catalogue type, what was added (`catalog-type.mjs`)

- `card.image`: the key of a text field holding the picture reference.
- `card.company`: the key of a text field that holds the name of a company (a job's client). When it is the same field as the card's subtitle, the line is led by the company's drawn mark (`Logo`).
- `card.chips`: up to six field keys. Choices and texts are drawn as coloured tags (a choice of the letters A to G, an energy class, runs from green to red); numbers are drawn as stats (« 68 m² » from the unit in the label, else « 3 rooms »).
- `map: { lat, lng }`: two different number fields that place an item. A type with a `map` gets the `map` view (and says so in `views`); `views` may not list `map` without it.

## The map view

A split page: the cards on the left, a **real map** on the right (`MapSwitch` in the Catalog client, over `RealMap`, with the old schematic `MapView` kept as the fallback). The pins sit where the two number fields of the type's `map` say (real latitude and longitude: the real-estate sample places its sixteen properties on real Paris streets, from OpenStreetMap), with the price in short form (« €385k »). The Map button exists only for a type that has a `map` (the real-estate template's `property`); with one template active at a time (above), the other templates' types never offer it.

**What draws it.** MapLibre GL JS 5.24.0 (BSD-3, vector and WebGL), vendored in `packages/kybernos-catalog/vendor/` with its licence, source URL and sha256 in `vendor/NOTICES.md` (`test-map.mjs` checks the hashes). The host half serves the two files, behind the same session guard as every route of the plugin: `GET /kybernos-catalog/vendor/maplibre-gl.js` and `.css`. The tiles and fonts come from **OpenFreeMap** (https://tiles.openfreemap.org, no key, no account), in its light style « positron ». Its attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap contributors) is drawn bottom-right and stays on the map; the drawn fallback is not OpenStreetMap and does not carry it.

**Nothing is fetched until the Map view is opened.** The library, the style and the tiles are asked for when `RealMap` mounts: no other view and no other page loads any of it (`test-map.mjs`: loading and applying the plugin makes no request and adds no node to the page). The one remote host is declared in the manifest as `net:tiles.openfreemap.org`. Requests carry no cookie and no referrer (`credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, also for the tiles, which the library's worker asks for, through `transformRequest`); the browser still names the page's origin (its own local address), as it does on any request to another host. `scripts/check-catalog-map-live.mjs` records the requests of the page and of the worker in a real browser and checks all of this.

**Privacy.** Opening the Map view fetches the map from OpenFreeMap, which therefore learns the area you look at (the tiles asked for) and your IP address. The items themselves (titles, prices, addresses) are never sent: only the coordinates of the tiles in view. The help of the page says so.

**The style is ours.** `tweakStyle` takes the fetched positron style and makes it quiet: shields, airports, district lines, tunnels and piers are dropped, street and district names come in later (`STYLE_MINZOOM`), the sprite and the dot icons are gone (so the sprite is never asked for), and names follow the language (`name:fr` for a French page). Its colours are replaced by `paletteFrom(tokens)`: the page's own tokens read where the map sits, every grey a step from the page's surface toward its ink (the light page has three white layers, so the layers themselves cannot be the steps), water and parks a tint of the product's blue and green. A light and a dark page give a light and a dark map from the same recipe, and one that changes while the map is open re-colours it (a watcher compares the tokens every 1.5 s and calls `setStyle` with `diff`). A layer no role knows keeps its colour in a light page and has its lightness turned over in a dark one, so a layer added to the style later is never a white patch.

**Pins.** Our price pills are the only strong element: white (light) or raised (dark) with a border, the hovered one filled with the ink colour, the chosen one filled with the accent. They are buttons placed by the library as markers (Tab and Enter work as before; `aria-pressed` says which is chosen). Pills that would overlap make a **cluster** (a round count bubble: the one circle among the product's rounded corners); clustering is by zoom only, so panning moves nothing. The first view keeps room round the places (`MAP_FIT`) so that no pill is cut by the edge or lies under the caption, the credit or the buttons (measured at 1400 px and at 420 px by the live check); on a touch screen the tap area of a pill is a few pixels larger than its drawing. A click on a cluster fits its members in view (or, for items on one spot that no zoom can part, opens the first). Pin and card light each other on hover, a click opens the item as a panel above the cards (never over the map), and choosing an item (a pin or a card) flies the map to it, far enough in that it stands out of any cluster. When the items change (a filter) the pins follow and the map fits the new set only if some of it is out of view. The buttons (zoom in and out, « show everything ») are ours, in the product's tokens. `prefers-reduced-motion` stops the fades and the pill motion and turns every flight into a jump.

**When it cannot be had, the drawn map takes over.** The schematic `MapView` (a town drawn from a seed, its caption saying it is a drawing) is shown, with the reason in the caption, when: no item has a place (nothing is asked of anyone), WebGL is missing, the browser says it is offline, the library file does not come, the style cannot be fetched, the map cannot start, every tile fails, or nothing is drawn within 8 s (`MAP_BUDGET_MS`). A failure is remembered for a minute, so going back and forth between the views does not wait for the timeout each time; a « Try again » button (and the browser coming back online) asks again at once. Never a blank or broken box: while the map loads the box says so, and the caption and the attribution are there from the start. A tab in the background gets no animation frames, so a map opened there cannot draw: its clock waits for the person to come back instead of running out. A map that has drawn something and then loses the network keeps what it has (pins on the land colour); it is not switched to the drawing.

Items with no place are counted in the caption and stay in the list. A narrow screen (up to 900 px) stacks the map above the cards and asks for two fingers (cooperative gestures, in the person's language).

**Tests.** `test-map.mjs` (pure helpers and both components over a fake library and DOM, hermetic), `test-client.mjs` (the page, the drawn map), `test-host.mjs` and `test-write-guard.mjs` (the vendor routes), and in a sandbox `node scripts/check-catalog-map-live.mjs` (a real browser: both templates installed with real estate last, so it is the active one; real tiles, both schemes, a phone width opened fresh, the fallbacks with the tile host blocked).

## The shortlist and the sort

The heart on a card keeps the item in a shortlist in this browser (`kybernos.catalog.shortlist.v1`); the star of the bar shows the shortlist only. The sort works on the rows that are loaded (the host sorts by latest change, and pages by 100).
