# kybernos-catalog

What you sell, rent or recruit for — products, properties, jobs — as cards or a list, with the fields and statuses the active theme defines.
One of the three business plugins (Contacts, Catalog, Pipeline) built on the shared business base (`docs/dev/business-base.md`).

## Where and how

The **Business** group of the sidebar › **Catalog** (the row appears once the plugin is switched on; a theme can rename it).

1. Search, filter by status (chips with counts), switch between **cards** and **list** (the views the theme's type allows).
2. Click an item for its sheet: the fields of its type, the card flag (« Only 3 left »), **Edit**, **Archive**. Archived items live under **Archived** and can be restored.
3. **New** adds an item. The form follows the type: title, subtitle, price, status and the type's own fields (text, number, money, date, choice, email, url).
4. Rows marked **demo** are a theme's sample data; **Clear sample data** removes the **active template's** (the base clears the sample rows of Contacts and Pipeline of that template too — the dialog says so). What the person added stays, and so do the other templates' samples.

**One template at a time.** With several templates installed, the page offers the types of the **active** one only and lists its rows only (`docs/dev/business-visuals.md`): the type chips, the « New » type choice and the status counts follow the selector of the Business group. No code in this plugin picks the template: the host reads `scope()` of the base and filters the registry's contributions by the plugin that made them.

Without a theme the page uses one plain type, **Item**, with the statuses Draft, Live and Archived. With a theme, the page speaks its words.
A row keeps only the **key** of its type and status; when a theme goes away its rows stay and are drawn as generic rows.
Photos never go in git: a neutral tile stands in until the person adds theirs (not built yet).

## For an agent

| Tool | |
|---|---|
| `catalog_find` | reads: `q`, `type`, `status`, `include_archived`, at most 50 items. Free. |
| `catalog_upsert` | adds an item (a `title` is needed) or changes one (`id`). DSH's own tool approval asks each time; the journal of the base says `agent`. |

Neither tool sends anything or reaches the network.

## What it is made of

| File | |
|---|---|
| `index.js` | host: tells the registry its point, mounts the routes and the tools. Never throws, reads the base **at request time**, never at boot |
| `catalog-core.mjs` | pure: the active types, the checks of a write against them, the operations over the base (injected ports) |
| `catalog-tools.mjs` | the two agent tools |
| `catalog-type.mjs` | the point `kybernos/catalog#type` (statuses, fields, card, views) and its check |
| `session-guard.mjs`, `lib-session-test.mjs` | the shared copy of the session guard |
| `client.js` | the page, the menu row and the styles (DSH tokens only) |

Routes, all under `/kybernos-catalog`, **every one needing DSH's signed session cookie, reads included**: `GET types`, `GET list` (`q`, `type`, `status`, `archived=only`,
`limit` ≤ 500, `offset`), `GET get`, `POST create`, `update`, `archive`, `restore`, `clear-demo` (`{ confirm: true }`). A write also needs the strict same origin and
is refused through the phone link. Data: `<DSH home>/kybernos/business/donnees.sqlite`, table `item`.

## Tests

```bash
cd packages/kybernos-catalog && for t in test-*.mjs; do node "$t" || break; done      # host, write guard, client, the point
source scripts/sandbox/env.sh && node scripts/check-catalog-live.mjs                  # the real page in the sandbox (never :3080)
```
