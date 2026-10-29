# Shipped themes

The product ships three themes, as folders of data in the core: `packages/kybernos-plugin/themes/<dir>/`. They are the same unit as any
theme ([`sector-bundles.md`](sector-bundles.md): one folder, one `plugin.json`, several `extends`), plus the three business points
(Contacts, Catalog, Pipeline, [`business-base.md`](business-base.md)) and a folder of sample rows. Nothing in them is code, media or a path.

| Folder | Id | Business rows | Boards | Kit |
|---|---|---|---|---|
| `ecommerce/` | `kybernos-themes/ecommerce` | Customers · Products · Orders | Orders | 2 skills, 1 team, 2 automations, 4 goals (from the `com` pack) |
| `real-estate/` | `kybernos-themes/real-estate` | Contacts · Properties · Sales and lettings | Sales, Lettings | 2 skills, 1 team, 3 automations, 4 goals (from `immo`) |
| `recruitment/` | `kybernos-themes/recruitment` | Candidates and clients · Jobs · Placements | Candidates, Client missions | 2 skills, 1 team, 4 automations, 4 goals (from the former `recrutement`) |

Each is installable alone, from its folder or by id (the installer treats both the same): it brings its field pack, its style and an empty
bundle patch, and it passes `plugin-check`. What it needs from the product is only the six plugins it names in `requires.plugins`: the core's
three seams and the three business plugins.

## The folder

```
<dir>/
  plugin.json            id kybernos-themes/<dir>, author kybernos-themes, Apache-2.0, name and description in en and fr,
                         keywords (the first one is the chip of the card), requires.plugins (core, theme, skills, contacts,
                         catalog, pipeline: ^1.0), extends the eight points
  why.json               one line per business plugin, in this theme's words (not a data point: the gallery reads it, plugin-check ignores it)
  package.json           "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } and nothing else under dsh
  cordis.patch.yml       the empty patch: []
  domains/<id>.json      the field pack: words, accent, icon, tagline, menu.labels (the three business rows included), goals
  themes/<id>.json       the style: { id, name, settings }, the settings of a shipped preset of the gallery
  skills/<name>/SKILL.md the theme's own skills
  teams/<id>.json        an Agent Team template
  automations/<id>.json  automation templates; created switched off
  contacts/<id>.json     kinds of contact (person or company), fields, tags
  catalog/<id>.json      one file per kind of item: statuses, fields, what the card shows
  pipeline/<id>.json     one file per board: stages (2 to 8), how a value is counted, what a card may link to
  demo/sample.json       the sample rows (below)
  README.md              what is inside, in English
```

`demo/` is not declared by `extends`: `plugin-check` names it in one `SKIP` line, as it does for any folder that is not a contribution.

## What the Templates page reads

For a card, `readShipped` (`packages/kybernos-plugin/themes-shipped.mjs`) keeps: the first manifest keyword, capitalised, as the chip over the card
(`commerce`, `property`, `people`), the manifest `name` (80 characters) and `description` (300),
the pack's `name`, `tagline` (200), `accent`, `icon` and the three words of `menu.labels.contacts|catalog|pipeline` (40 each), the style's
`name`, `needs` (the plugins named in `requires.plugins` beyond the core's seams: the three business plugins) and the **names** of what is under
`skills/`, `teams/` and `automations/`. So a file is named for the person who reads the card: `order-replies`, `shop-desk`, `daily-stock`.
`why.json` gives each plugin the theme needs one line (`{ "kybernos/contacts": { "en": …, "fr": … }, … }`, 160 characters at most) that says what it does
for this trade: « Orders from new to delivered. » The gallery draws a cover itself: **no picture is shipped**, a `cover.jpg` is refused by `garde-depot`.

## The sample rows

`demo/sample.json` is exactly the `data` argument of the base's `seed(data, { theme })`: `{ contacts, items, cards, notes }`. The base marks
every row `demo = 1`, seeds a theme once (a second call answers `skipped`), and `clearDemo()` removes them without touching what the person made.

```jsonc
{ "contacts": [{ "ref": "amelia-hart", "kind": "person", "type": "customer", "name": "Amelia Hart", "email": "amelia.hart@example.com",
                 "company_ref": "cafe-bleu", "tags": ["repeat"], "fields": { "city": "Lyon" } }],
  "items":    [{ "ref": "olive-board", "type": "product", "title": "Olive wood board", "subtitle": "FC-BRD-01", "status": "live",
                 "price_text": "€46", "price_num": 46, "fields": { "sku": "FC-BRD-01", "price": 46, "stock": 15 } }],
  "cards":    [{ "flow": "orders", "stage": "new", "title": "#1046 · Jonas Weber", "subtitle": "2 items", "value_num": 63,
                 "contact_ref": "jonas-weber", "item_ref": "olive-board" }],
  "notes":    [{ "contact_ref": "amelia-hart", "body": "Asked for gift wrapping on her next order." }] }
```

Rules (all checked by `scripts/test-shipped-themes.mjs`):

- **Only what the theme defines.** A contact's `type` is a type of the theme's contacts file and its `kind` is that type's kind; its `tags` are the
  theme's tags; its `fields` are fields of the schema, each value as its type says (a `choice` is one of its options, a `date` is `YYYY-MM-DD`).
  An item's `type` is a catalog file, its `status` a status of that type, its `fields` fields of that type. A card's `flow` is a board, its `stage` a
  stage of that board, and it links a contact or an item only if the board's `links` allows it. Every `*_ref` points at a row of the same file.
- **Modest and readable.** About 8 people and 4 companies, 8 to 12 items, 10 to 14 cards, every stage of every board used at least once, a few notes.
  The order of the cards in the file is the order inside a column.
- **Invented.** Every name, address and message is made up, e-mail addresses are on `example.com`, a company's is `hello@<name>.example.com`.
  No picture (rule 4), no path, no real person.
- **One price.** An item carries `price_text` (what a card prints, `€780 / month`) and, when its type has a `price` money field, the same
  number in `price_num` and in `fields.price`.

## Rules for the kit

- **Everything is written in English and French** (`{ "en": …, "fr": … }`), and a long French text is never a copy of the English one. Only
  `SKILL.md` files are English: they are instructions for an agent, and the pack's goal carries the French line.
- **Automations start switched off**, say that they draft and never send, and carry a guard. Every automation template is named by a goal of the pack,
  and the other way round.
- **A goal names only a skill the app can fetch**: a GitHub `owner/repo` or one the core bundles in `domains/skills/` (the route that seeds a
  `kybernos` skill reads that folder only). The theme's own skills travel through the skills point and the team template that names them.
  A theme never ships a skill the core already bundles.
- **Nothing collides.** The three themes can be installed together: no pack, style, skill, team, automation, schema, type or board id is shared,
  and none is the id of a pack of the core.

## Add a fourth theme

1. Copy the closest folder under `themes/` and rename it (the folder name, the manifest id, the pack, style and file ids all follow it).
2. Replace every text, in both languages; pick a gallery preset for the style (`packages/kybernos-theme/gallery.json`) or write its settings.
3. Write the three business points in the theme's own words, then `demo/sample.json` with the rules above.
4. Add the folder and its row counts to `EXPECT` in `scripts/test-shipped-themes.mjs`.
5. Run, and read the report:

```bash
node scripts/plugin-check.mjs packages/kybernos-plugin/themes/<dir>
node scripts/test-shipped-themes.mjs
```

## What a theme cannot say today

The validators of the points are not to be loosened by a theme; these are the places where they are narrower than the mockups.

- **The style's `name` is one string.** `sanitizePreset` refuses an `{ en, fr }` object, so the style of a card is named in English only.
- **The options of a `choice` field are plain strings**, not translated: only language-neutral options (an energy class `A` to `G`, a seniority
  `Junior`, `Senior`) are used; anything a person reads in their own language is a `text` field.
- **A board's value has a format and a currency, nothing else.** A monthly rent is shown as an amount without `/ month`, and the recruitment
  boards cannot say that the value is an estimated fee.
- **A card's flag compares one number or money field.** The property's « Offer received » is a money field with `gte: 1`; there is no flag on a status.
