# Business pages: the visual kit, pictures, the map

What Contacts, Catalog and Pipeline share so they look alike and feel alive, and how a template brings pictures and places. Everything is drawn or served locally: no page here fetches anything from the internet.

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

A split page: the cards on the left, a **schematic** map on the right (`MapView` in the Catalog client). The town behind the pins (blocks, parks, two avenues, a lake and a river) is drawn from a seed, the pins sit where the two number fields say, scaled to fill the box, with the price in short form (« €385k »). It is a drawing, not a survey, and its caption says so. Pin and card light each other on hover; a pin is a button (Tab, Enter); drag to move, the buttons or the wheel to zoom; the details of an item opened from the map sit above the cards, never over the map. Items with no place are counted in the caption and stay in the list. Real tiles (OpenStreetMap or another) are a decision for later: they would fetch from the internet and tell a server what the person is looking at.

## The shortlist and the sort

The heart on a card keeps the item in a shortlist in this browser (`kybernos.catalog.shortlist.v1`); the star of the bar shows the shortlist only. The sort works on the rows that are loaded (the host sorts by latest change, and pages by 100).
