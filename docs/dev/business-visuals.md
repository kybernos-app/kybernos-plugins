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
