# Shipped themes

The product ships three themes, as folders of data in the core: `packages/kybernos-plugin/themes/<dir>/`. They are the same unit as any
theme ([`sector-bundles.md`](sector-bundles.md): one folder, one `plugin.json`, several `extends`), plus a ready database (`kybernos/db#template`, the Tables plugin),
a dashboard (`kybernos/dashboards#preset`) and a folder of sample rows. Nothing in them is code, media or a path.

| Folder | Id | Tables | Boards | Dashboard | Kit |
|---|---|---|---|---|---|
| `ecommerce/` | `kybernos-themes/ecommerce` | Contacts · Products · Orders · Notes | Orders | Shop overview | 2 skills, 1 team, 2 automations, 4 goals (from the `com` pack) |
| `real-estate/` | `kybernos-themes/real-estate` | Contacts · Properties · Lettings · Sales · Notes | Sales, Lettings | Agency overview | 2 skills, 1 team, 3 automations, 4 goals (from `immo`) |
| `recruitment/` | `kybernos-themes/recruitment` | Contacts · Jobs · Candidates · Client missions · Notes | Candidates, Client missions | Desk overview | 2 skills, 1 team, 4 automations, 4 goals (from the former `recrutement`) |

Each is installable alone, from its folder or by id (the installer treats both the same): it brings its field pack, its style and an empty
bundle patch, and it passes `plugin-check`. What it needs from the product is the plugins it names in `requires.plugins` (the core's three seams and Tables) and,
as an optional extension, Dashboards. Installing a template switches on what is missing (Tables, Dashboards) through the Suite; Tables appears after a restart of DSH
and the template's database is made then (`applied.db.pending` in the install record, made once Tables runs). Several templates installed together are several databases, side by side.

## The folder

```
<dir>/
  plugin.json            id kybernos-themes/<dir>, author kybernos-themes, Apache-2.0, name and description in en and fr,
                         keywords (the first one is the chip of the card), requires.plugins (core, theme, skills: ^1.0, db: ^0.1),
                         extends the seven points (the dashboards one optional)
  why.json               one line per needed plugin, in this theme's words (not a data point: the gallery reads it, plugin-check ignores it)
  package.json           "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } and nothing else under dsh
  cordis.patch.yml       the empty patch: []
  domains/<id>.json      the field pack: words, accent, icon, tagline, menu.labels (the Tables row may be renamed), goals
  themes/<id>.json       the style: { id, name, settings }, the settings of a shipped preset of the gallery
  skills/<name>/SKILL.md the theme's own skills
  teams/<id>.json        an Agent Team template
  automations/<id>.json  automation templates; created switched off
  dashboards/<id>.json   a dashboard of the trade (kybernos/dashboards#preset): widgets over the database's rows (`db.rows` source), the word of its menu row
  db/<id>.json           the trade as one ready database (kybernos/db#template): objects, fields, links, saved views, every label in English and French
  demo/db-sample.json    the sample rows: { rows: { <object>: [{ ref?, values }] } }, links as { ref }, pictures as { photo } (README of kybernos-db)
  demo/photos/<name>.jpg the sample pictures the rows name
  README.md              what is inside, in English
```

`demo/` is not declared by `extends`: `plugin-check` names it in one `SKIP` line, as it does for any folder that is not a contribution. A cover (`cover.jpg`, 16:9) is the one picture of the card.

## What the Templates page reads

For a card, `readShipped` (`packages/kybernos-plugin/themes-shipped.mjs`) keeps: the first manifest keyword, capitalised, as the chip over the card
(`commerce`, `property`, `people`), the manifest `name` (80 characters) and `description` (300),
the pack's `name`, `tagline` (200), `accent`, `icon` and the word of `menu.labels.tables` (40), the style's
`name`, `needs` (the plugins named in `requires.plugins` beyond the core's seams: Tables first, then the owner of an optional extension, the Dashboards), the **tables** the database makes
(`db.objects`), the sample rows counted table by table (`sample`) and the **names** of what is under
`skills/`, `teams/` and `automations/`. So a file is named for the person who reads the card: `order-replies`, `shop-desk`, `daily-stock`.
`why.json` gives each plugin the theme needs (the Dashboards too) one line (`{ "kybernos/db": { "en": …, "fr": … }, … }`, 160 characters at most) that says what it does
for this trade: « Orders from new to delivered. » The gallery draws a cover itself: **no picture is shipped**, a `cover.jpg` is refused by `garde-depot`.

## The sample rows

`demo/db-sample.json` is the `sample` argument of the Tables seam (`install({ template, sample, lang, photo })`, `packages/kybernos-db/README.md`, « Templates »): `{ rows: { <object key>: [{ ref?, values }] } }`.
The rows are made with the database, in the person's language, and they are ordinary rows from then on: the person edits or deletes them like any other, and a page can leave them out
(the « Sample rows » switch of the install plan makes the structure only). A second install of the same template answers `skipped` while its database still exists.

```jsonc
{ "rows": {
    "contact": [{ "ref": "amelia-hart", "values": { "name": "Amelia Hart", "kind": "person", "type": "customer", "email": "amelia.hart@example.com",
                  "city": "Lyon", "tags": ["repeat"], "photo": [{ "photo": "ecommerce/amelia-hart" }] } }],
    "product": [{ "ref": "olive-board", "values": { "title": "Olive wood board", "status": "live", "price": 46, "stock": 15, "photo": [{ "photo": "ecommerce/olive-board" }] } }],
    "orders":  [{ "values": { "title": "#1046 · Jonas Weber", "stage": "new", "value": 63, "contact": { "ref": "jonas-weber" }, "product": { "ref": "olive-board" } } }],
    "note":    [{ "values": { "contact": { "ref": "amelia-hart" }, "body": "Asked for gift wrapping on her next order." } }] } }
```

Rules (all checked by `scripts/test-shipped-themes.mjs`):

- **Only what the theme defines.** Every value is a field of the table, as its type says (a `choice` is one of its options, a `date` is `YYYY-MM-DD`); a link is `{ ref }` to a row of the same file;
  the structure and the rows pass `validateTemplate`, `validateSample` and `buildStructure` in both languages (`packages/kybernos-db/template.mjs`).
- **Modest and readable.** The pages must look lived in: about 8 people and 4 companies among the contacts, every stage of every board used at least once, the row counts of the `EXPECT` list of
  `scripts/test-shipped-themes.mjs` (a rich theme). The order of the rows in the file is the order inside a column.
- **Placed for real.** A table with a map view (the real-estate properties) puts each sample row at a REAL latitude and longitude, a point on a real street of ONE city (Paris for `real-estate`: each property in the neighbourhood its `district` says, 4 decimals, read from OpenStreetMap), because the Map view is a real map; the names, addresses and prices stay invented. `scripts/test-shipped-themes.mjs` holds every row of such a table inside that city, each on its own spot.
- **Invented.** Every name, address and message is made up, e-mail addresses are on `example.com`, a company's is `hello@<name>.example.com`.
  No path, no real person. The only pictures are the sample pictures (rule 4): a row names its photograph or portrait in an `attachment` field (`{ "photo": "<theme dir>/<name>" }`),
  at `demo/photos/<name>.jpg`, 24 a theme at most, each 1280 px wide and 220 KB at most. A photograph
  serves two related items at most and a portrait two people at most, so a theme fits in 24. A company has no file. They are invented
  scenes and fictitious people: `scripts/theme-photos.mjs` asks FLUX 2 for one picture at a time; the plans are `docs/dev/theme-photos/<theme dir>-photos.json` and
  `-portraits.json` (the raw answers stay out of git, see `docs/dev/business-visuals.md`).
- **One price.** A row carries the number a card prints (`price`, `value`) as a money or number field, never a text such as `€780 / month`.

## Rules for the kit

- **Everything is written in English and French** (`{ "en": …, "fr": … }`), and a long French text is never a copy of the English one. Only
  `SKILL.md` files are English: they are instructions for an agent, and the pack's goal carries the French line.
- **Automations start switched off**, say that they draft and never send, and carry a guard. Every automation template is named by a goal of the pack,
  and the other way round.
- **A goal names only a skill the app can fetch**: a GitHub `owner/repo` or one the core bundles in `domains/skills/` (the route that seeds a
  `kybernos` skill reads that folder only). The theme's own skills travel through the skills point and the team template that names them.
  A theme never ships a skill the core already bundles.
- **Nothing collides.** The three themes can be installed together: no pack, style, skill, team, automation, database or dashboard id is shared,
  and none is the id of a pack of the core.

## Add a fourth theme

1. Copy the closest folder under `themes/` and rename it (the folder name, the manifest id, the pack, style and file ids all follow it).
2. Replace every text, in both languages; pick a gallery preset for the style (`packages/kybernos-theme/gallery.json`) or write its settings.
3. Write the database (`db/<id>.json`) in the theme's own words, then `demo/db-sample.json` with the rules above.
4. Add the folder and its row counts to `EXPECT` in `scripts/test-shipped-themes.mjs`.
5. Run, and read the report:

```bash
node scripts/plugin-check.mjs packages/kybernos-plugin/themes/<dir>
node scripts/test-shipped-themes.mjs
```

## What a theme cannot say today

The validators of the points are not to be loosened by a theme; these are the places where they are narrower than the mockups.

- **The style's `name` is one string.** `sanitizePreset` refuses an `{ en, fr }` object, so the style of a card is named in English only.

The database no longer has these limits: the labels of its tables, fields, options and views come in English and French, and a board is a saved view over any choice field.
