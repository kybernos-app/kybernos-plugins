# Business pages: the visual kit, pictures, the map

What Contacts, Catalog and Pipeline share so they look alike and feel alive, and how a template brings pictures and places. Everything is drawn or served locally, with one exception: the Map view of the Catalog fetches its map tiles from OpenFreeMap, and only when that view is opened (below).

## The product's bar

The core hands every business page `props.toolbar = { KbToolbar, useToolbarState }` (`kbBizToolbar` in `packages/kybernos-plugin/client.js`). A page draws the bar in its header row, to the right of the title (`kb6-headrow`): search, favourites star, a view switch with the names beside the icons (`viewLabels: true`), the filter and sort menu, then its primary action as `trailing`. The state comes from `useToolbarState('<page id>', defaults)` (kept in this browser, per page). Without the toolbar (a test, an older core) a page draws a plain bar of its own with the same pieces. `KbToolbar` knows the views `cards`, `list`, `calendar`, `columns` and `map`.

## `window.__KB_BIZ_KIT__`

Published by the core (block `<kb-business-kit>`, test `packages/kybernos-plugin/test-business-kit.mjs`); a page reads it when it renders, never at load, and falls back to plain chips when it is missing.

| | |
|---|---|
| `Tag({ text, hue, dot, icon, on, onClick })` | A coloured chip; the colour follows the text (`tint(text)`), so « pre-approved » is always the same colour. A button only when it is clicked. |
| `Avatar({ name, size, kind })` | Initials on a gradient; `kind: 'company'` draws a rounded square with a building. |
| `Art({ spec })` | An illustration drawn from a spec `art:<kind>[/<seed>][@<hue>]`. Kinds: house, apartment, villa, loft, shop, box, bottle, bag, desk. Anything else draws nothing. |
| `Icon(name, size)` | The business icons (pin, bed, bath, ruler, tag, euro, building, leaf, sparkle, cart, truck, cap, clock, key, heart, star, layers, map, grid, list), then the core's own. |
| CSS classes | `kz-lift` (hover lift), `kz-in` with `--kz-i` (staggered entry), `kz-press`, `kz-pop`, `kz-img` (a picture that zooms a little on hover). All stop under `prefers-reduced-motion`. |

## Pictures

A catalogue type names a text field in `card.image`. Its value is one of:

- `photo:<template dir>/<name>`: a sample photograph the template ships at `themes/<dir>/demo/photos/<name>.jpg`, served by the core at `GET /kybernos/themes/photo?id=<dir>/<name>` (same origin, a plain JPEG found by id, never by path: `photoFile` in `themes-shipped.mjs`);
- `art:<kind>/<seed>`: a drawn picture (above).

A photograph that does not load turns into the drawn picture that goes with the type's icon. The photographs are made by `scripts/theme-photos.mjs`: ONE FLUX 2 image on DeepInfra, a palette (a grid of separate photographs), cut into pictures with `sips`. A plan (`docs/dev/theme-photos/<name>.json`) is the recipe; the palette itself is not kept. A palette costs about 6 cents. The key is read from `DEEPINFRA_API_KEY` or from the DSH credentials file and is never printed. Per AGENTS rule 4 a theme may carry 16 such JPEGs of at most 80 KB each, nothing else.

## The catalogue type, what was added (`catalog-type.mjs`)

- `card.image`: the key of a text field holding the picture reference.
- `card.chips`: up to six field keys. Choices and texts are drawn as coloured tags (a choice of the letters A to G, an energy class, runs from green to red); numbers are drawn as stats (« 68 m² » from the unit in the label, else « 3 rooms »).
- `map: { lat, lng }`: two different number fields that place an item. A type with a `map` gets the `map` view (and says so in `views`); `views` may not list `map` without it.

## The map view

A split page: the cards on the left, a **real map** on the right (`MapSwitch` in the Catalog client, over `RealMap`, with the old schematic `MapView` kept as the fallback). The pins sit where the two number fields of the type's `map` say (real latitude and longitude: the real-estate sample places its sixteen properties on real Paris streets, from OpenStreetMap), with the price in short form (« €385k »).

**What draws it.** MapLibre GL JS 5.24.0 (BSD-3, vector and WebGL), vendored in `packages/kybernos-catalog/vendor/` with its licence, source URL and sha256 in `vendor/NOTICES.md` (`test-map.mjs` checks the hashes). The host half serves the two files, behind the same session guard as every route of the plugin: `GET /kybernos-catalog/vendor/maplibre-gl.js` and `.css`. The tiles and fonts come from **OpenFreeMap** (https://tiles.openfreemap.org, no key, no account), in its light style « positron ». Its attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap contributors) is drawn bottom-right and stays on the map; the drawn fallback is not OpenStreetMap and does not carry it.

**Nothing is fetched until the Map view is opened.** The library, the style and the tiles are asked for when `RealMap` mounts: no other view and no other page loads any of it (`test-map.mjs`: loading and applying the plugin makes no request and adds no node to the page). The one remote host is declared in the manifest as `net:tiles.openfreemap.org`. Requests carry no cookie and no referrer (`credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, also for the tiles, which the library's worker asks for, through `transformRequest`); the browser still names the page's origin (its own local address), as it does on any request to another host. `scripts/check-catalog-map-live.mjs` records the requests of the page and of the worker in a real browser and checks all of this.

**Privacy.** Opening the Map view fetches the map from OpenFreeMap, which therefore learns the area you look at (the tiles asked for) and your IP address. The items themselves (titles, prices, addresses) are never sent: only the coordinates of the tiles in view. The help of the page says so.

**The style is ours.** `tweakStyle` takes the fetched positron style and makes it quiet: shields, airports, district lines, tunnels and piers are dropped, street and district names come in later (`STYLE_MINZOOM`), the sprite and the dot icons are gone (so the sprite is never asked for), and names follow the language (`name:fr` for a French page). Its colours are replaced by `paletteFrom(tokens)`: the page's own tokens read where the map sits, every grey a step from the page's surface toward its ink (the light page has three white layers, so the layers themselves cannot be the steps), water and parks a tint of the product's blue and green. A light and a dark page give a light and a dark map from the same recipe, and one that changes while the map is open re-colours it (a watcher compares the tokens every 1.5 s and calls `setStyle` with `diff`). A layer no role knows keeps its colour in a light page and has its lightness turned over in a dark one, so a layer added to the style later is never a white patch.

**Pins.** Our price pills are the only strong element: white (light) or raised (dark) with a border, the hovered one filled with the ink colour, the chosen one filled with the accent. They are buttons placed by the library as markers (Tab and Enter work as before; `aria-pressed` says which is chosen). Pills that would overlap make a **cluster** (a round count bubble); clustering is by zoom only, so panning moves nothing. A click on a cluster fits its members in view (or, for items on one spot that no zoom can part, opens the first). Pin and card light each other on hover, a click opens the item as a panel above the cards (never over the map), and choosing an item (a pin or a card) flies the map to it, far enough in that it stands out of any cluster. When the items change (a filter) the pins follow and the map fits the new set only if some of it is out of view. The buttons (zoom in and out, « show everything ») are ours, in the product's tokens. `prefers-reduced-motion` stops the fades and the pill motion and turns every flight into a jump.

**When it cannot be had, the drawn map takes over.** The schematic `MapView` (a town drawn from a seed, its caption saying it is a drawing) is shown, with the reason in the caption, when: no item has a place (nothing is asked of anyone), WebGL is missing, the browser says it is offline, the library file does not come, the style cannot be fetched, the map cannot start, every tile fails, or nothing is drawn within 8 s (`MAP_BUDGET_MS`). A failure is remembered for a minute, so going back and forth between the views does not wait for the timeout each time; a « Try again » button (and the browser coming back online) asks again at once. Never a blank or broken box: while the map loads the box says so, and the caption and the attribution are there from the start. A tab in the background gets no animation frames, so a map opened there cannot draw: its clock waits for the person to come back instead of running out. A map that has drawn something and then loses the network keeps what it has (pins on the land colour); it is not switched to the drawing.

Items with no place are counted in the caption and stay in the list. A narrow screen (up to 900 px) stacks the map above the cards and asks for two fingers (cooperative gestures, in the person's language).

**Tests.** `test-map.mjs` (pure helpers and both components over a fake library and DOM, hermetic), `test-client.mjs` (the page, the drawn map), `test-host.mjs` and `test-write-guard.mjs` (the vendor routes), and in a sandbox `node scripts/check-catalog-map-live.mjs` (a real browser: real tiles, both schemes, a phone width, the fallbacks with the tile host blocked).

## The shortlist and the sort

The heart on a card keeps the item in a shortlist in this browser (`kybernos.catalog.shortlist.v1`); the star of the bar shows the shortlist only. The sort works on the rows that are loaded (the host sorts by latest change, and pages by 100).
