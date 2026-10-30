# Business pages: one template at a time, the visual kit, pictures, the map

What Contacts, Catalog and Pipeline share so they look alike and feel alive, which sector template they show (one at a time), and how a template brings pictures and places. Everything is drawn or served locally: no page here fetches anything from the internet.

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

A split page: the cards on the left, a **schematic** map on the right (`MapView` in the Catalog client). The town behind the pins (blocks, parks, two avenues, a lake and a river) is drawn from a seed, the pins sit where the two number fields say, scaled to fill the box, with the price in short form (« €385k »). It is a drawing, not a survey, and its caption says so. Pin and card light each other on hover; a pin is a button (Tab, Enter); drag to move, the buttons or the wheel to zoom; the details of an item opened from the map sit above the cards, never over the map. Items with no place are counted in the caption and stay in the list. Real tiles (OpenStreetMap or another) are a decision for later: they would fetch from the internet and tell a server what the person is looking at.

## The shortlist and the sort

The heart on a card keeps the item in a shortlist in this browser (`kybernos.catalog.shortlist.v1`); the star of the bar shows the shortlist only. The sort works on the rows that are loaded (the host sorts by latest change, and pages by 100).
