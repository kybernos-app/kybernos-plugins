# The « Business » group of the menu

A plugin that brings a business page puts one row in a collapsible « Business » group of the sidebar. Two do today: **Tables** (`kybernos-db`: the person's own
tables, linked, with their views) and **Overview** (`kybernos-dashboards`: the dashboard of the sector template). The core
knows none of them by name: it draws the group while at least one row is declared, and nothing otherwise. Three seams, all in
`packages/kybernos-plugin/client.js` (the pure part is the block `<kb-business-menu>`, the drawing is `<kb-business-ui>`).

## 1. Declare the row

```js
const off = window.__KB_MENU__ && window.__KB_MENU__.register({
  id: 'tables',                // 2-24 lower-case letters, digits, dashes; never the id of a page of the core
  group: 'business',           // the only group
  icon: 'users',               // a name of the core's icon table (unknown: a neutral icon is drawn)
  labelKey: 'business.tables',                   // a key of the core's dictionary…
  label: { en: 'Tables', fr: 'Tables' },         // …and/or the plugin's own words (`en` is required; fr, es, ar optional)
  order: 10,                   // optional, -1000..1000, default 100; ties keep the order of declaration
})
// `off()` takes the row back (idempotent). `register` returns null, and warns in the console, when the entry is refused.
```

- The registry is made when the core's own page half applies, and mount order does not promise that comes first: measured in a sandbox, a plugin applied before it, found no
  `window.__KB_MENU__` and its row was never declared. A plugin therefore declares in a small retry (look again every 100 ms for 10 s, the disposer clears the timer): see the
  menu-row effect in `packages/kybernos-db/client.js`. One that finds no registry in the end draws nothing.
- Declare inside the plugin's `apply()` and hand `off` to its cleanup: switching the plugin off takes its row away, and the page area redraws.
- `window.__KB_MENU__.check(entry)` says why an entry would be refused, without declaring it. At most 8 rows.
- The words of a row: a pack's `menu.labels.<id>` first (a theme renames « Tables » to « Properties »), then the plugin's `label` for the language,
  then the dictionary's `labelKey`, then `label.en`, then the id.
- A row can ask for attention: `window.__KB_MENU_STATE__.set('<id>', { review: n, need: n, running: bool })` draws the same ring and dot as the other
  rows; folded, the header adds up `review + need` in a badge (at most 99) and shows a ring while something runs.

## 2. Mount the page

The core declares ONE keyed child of the `main` slot, `main.kybernos-business`. A plugin registers its page on it with the id of its row as the key:

```js
ctx.effect(() => slots.inject('main.kybernos-business', () => slots.register({ name: 'main.kybernos-business', key: 'tables' }, TablesPage)), 'tables: page')
```

Measured in a sandbox (lot 6 spike): `slots.entriesOfSlot('main.kybernos-business')` returns one entry per key, `{ component, options: { key }, registrant }`, and
a second registration of the same key at the same priority throws. The core picks the entry whose `options.key` is the row's id; without one it says
« This page is not available. Switch its module on in the Suite. ». The page component receives `{ sessionId, toolbar }`.

## 3. What a pack and the page store see

- `menu.labels` of a domain pack accepts `tables` (`BUSINESS_ROW_IDS` in `domain-pack.mjs`). The registry lives in the
  browser and the host validates packs, so the host cannot read it: the id the plugins may take is listed there.
- `window.__KB_OPEN__.views` lists the declared rows next to the core's pages.
- **No template selector.** Several sector templates can be installed side by side: each one is a database of its own on the Tables page (its picker), and the Overview row opens the
  dashboard of the first installed template (the Dashboards page lists the dashboards of all of them). A control of a page that must not close the phone's drawer carries `data-kb-keep-open` (`kybernos-mobile`).
- The group is folded or open as the person left it, in `localStorage` (`kybernos.menu.business.collapsed.v1`, per browser, read and written inside
  try/catch). Nothing depends on it: without storage the group starts open.
- In the collapsed icon rail the header goes away and the rows always show.

## Handing a sentence to Kaby: `window.__KB_ASK__`

A page of the group that wants the person to ask Kaby something (« Modify view » and « Ask Kaby… » on the Tables page) calls `window.__KB_ASK__(text)`: the core's
`kbStartChatText`, which opens a chat with `text` already written in the composer so the person reads it and sends it. It answers `false` when no chat can be
opened; the page then offers the sentence to copy. The call is guarded (the seam is absent without the core) and nothing is sent by the page itself.

## Tests

`node packages/kybernos-plugin/test-business-menu.mjs` (the registry cut out of `client.js`, plus where the core reads it and the CSS promises) and,
against the sandbox, `source scripts/sandbox/env.sh && node scripts/check-menu-business-live.mjs [--shots <dir>]`: two fake rows declared from the page, a
real mouse folds and opens the group, the badge, a reload, a row opens its page and is the selected one, a core row still works, the icon rail, and the
rows going away.
