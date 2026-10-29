# Business pages: the visual kit, pictures, the map

What Contacts, Catalog and Pipeline share so they look alike and feel alive, and how a template brings pictures and places. Everything is drawn or served locally: no page here fetches anything from the internet.

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

A split page: the cards on the left, a **schematic** map on the right (`MapView` in the Catalog client). The town behind the pins (blocks, parks, two avenues, a lake and a river) is drawn from a seed, the pins sit where the two number fields say, scaled to fill the box, with the price in short form (« €385k »). It is a drawing, not a survey, and its caption says so. Pin and card light each other on hover; a pin is a button (Tab, Enter); drag to move, the buttons or the wheel to zoom; the details of an item opened from the map sit above the cards, never over the map. Items with no place are counted in the caption and stay in the list. Real tiles (OpenStreetMap or another) are a decision for later: they would fetch from the internet and tell a server what the person is looking at.

## The shortlist and the sort

The heart on a card keeps the item in a shortlist in this browser (`kybernos.catalog.shortlist.v1`); the star of the bar shows the shortlist only. The sort works on the rows that are loaded (the host sorts by latest change, and pages by 100).
