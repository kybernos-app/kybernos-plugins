# acme/garden-shop — the starter for the business points

**Sample data for a fictional author (`acme`).** `acme` is not a company and every sentence in this folder is a **proposal**. Nothing here is
ever executed or fetched.

This theme does one thing: it tells the three business plugins its words. It needs Contacts, Catalog and Pipeline (`requires.plugins`) and
contributes to the three points they own. The five points of the vet-clinic starter (`../acme-vet-clinic`) are separate: a real theme extends
both sets.

| Folder | Point | One file = |
|---|---|---|
| `contacts/` | `kybernos/contacts#schema` | the kinds of contact (a person or a company), the fields and the tags the theme speaks of |
| `catalog/` | `kybernos/catalog#type` | one kind of item: its statuses, fields, what a card shows, its views |
| `pipeline/` | `kybernos/pipeline#flow` | one board: its stages, how its value is counted, what a card may link to |

The file's name is the `id` inside it (`plant.json` holds `"id": "plant"`). Texts carry `en` and may carry `fr`, `es` and `ar`. A card or a flag
names a field **by key**: a key the type does not define is refused when the folder is checked, not drawn wrong later. Sample rows for the
pages are a later lot's work: this folder does not carry any.

```bash
node scripts/plugin-check.mjs docs/dev/templates/acme-garden-shop
```

The `broken/` folders are deliberate faults, one per point, for learning the validators. They are not part of the plugin and are never installed.
