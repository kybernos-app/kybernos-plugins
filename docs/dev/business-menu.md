# The sidebar menu and the page registry

The menu is **fixed**: Dashboards, Automations, Connectors, Skills, Agent Teams, Apps, Creations. There is no « Business » group header, no
Templates row and no Overview row (the sector dashboard is reached from Dashboards). The core knows no business plugin by name; Apps is the one row a
plugin declares today (`kybernos-db`, row id `tables`). Three seams, all in `packages/kybernos-plugin/client.js` (the pure part is the block
`<kb-business-menu>`, the drawing is `<kb-business-ui>`).

## 1. Declare the row

```js
const off = window.__KB_MENU__ && window.__KB_MENU__.register({
  id: 'tables',                // 2-24 lower-case letters, digits, dashes; never the id of a page of the core
  group: 'business',           // the only group (a registry key, not a header anyone sees)
  icon: 'grid',                // a name of the core's icon table (unknown: a neutral icon is drawn)
  labelKey: 'business.apps',                     // a key of the core's dictionary…
  label: { en: 'Apps', fr: 'Apps' },              // …and/or the plugin's own words (`en` is required; fr, es, ar optional)
  order: 40,                   // optional, -1000..1000, default 100; ties keep the order of declaration
})
// `off()` takes the row back (idempotent). `register` returns null, and warns in the console, when the entry is refused.
```

- Registry rows are drawn **flat, right after Agent Teams**, with no header and no fold. The core still draws nothing while no row is declared.
- The registry is made when the core's own page half applies, and mount order does not promise that comes first: measured in a sandbox, a plugin applied before it found no
  `window.__KB_MENU__` and its row was never declared. A plugin therefore declares in a small retry (look again every 100 ms for 10 s, the disposer clears the timer): see the
  menu-row effect in `packages/kybernos-db/client.js`. One that finds no registry in the end draws nothing.
- Declare inside the plugin's `apply()` and hand `off` to its cleanup: switching the plugin off takes its row away, and the page area redraws.
- `window.__KB_MENU__.check(entry)` says why an entry would be refused, without declaring it. At most 8 rows.
- The words of a row: the plugin's `label` for the language, then the dictionary's `labelKey`, then `label.en`, then the id. A pack's `menu.labels` no longer
  renames these fixed rows (the host still parses them; they are ignored by the menu).
- A row can ask for attention: `window.__KB_MENU_STATE__.set('<id>', { review: n, need: n, running: bool })` draws the same ring and dot as the other rows.

## 2. Mount the page

The core declares ONE keyed child of the `main` slot, `main.kybernos-business`. A plugin registers its page on it with the id of its row as the key:

```js
ctx.effect(() => slots.inject('main.kybernos-business', () => slots.register({ name: 'main.kybernos-business', key: 'tables' }, TablesPage)), 'tables: page')
```

`slots.entriesOfSlot('main.kybernos-business')` returns one entry per key, `{ component, options: { key }, registrant }`, and a second registration of the same key at
the same priority throws. The core picks the entry whose `options.key` is the row's id; without one it says « This page is not available. Switch its module on in the Suite. ».
The page component receives `{ sessionId, toolbar }`. `window.__KB_OPEN__.views` lists the declared rows next to the core's pages.

## 3. Templates reach Apps through a door, not a menu row

Sector templates are not a page of the menu: the Apps page asks `window.__KB_TEMPLATES__` (block `<kb-templates-seam>`, built on the theme machinery of Settings › Templates):

- `list()` answers `[{ id, name, line, tag, extras, tables, have, appId? }]`, one per shipped template that brings a database; `[]` on any failure.
- `add(id, { sample, kit })` brings the template in, runs its plan and answers `{ ok, appId?, message? }`; it never throws and is idempotent (a second call finds the same app).
- `sample` seeds the demo rows; `kit` also ticks the skills, agent team and automations and switches on the dashboard bundle. The look and the field are never touched.
- The template's database carries its template id as a marker (`dbs[].template` of `/kybernos-db/state`); that is how `have` and `appId` are known.

The Settings › Templates page keeps working as before (its code is untouched and reachable from Settings).

## Handing a sentence to Kaby: `window.__KB_ASK__`

A page that wants the person to ask Kaby something (« Modify view » and « Ask Kaby… » on the Apps page) calls `window.__KB_ASK__(text)`: the core's
`kbStartChatText`, which opens a chat with `text` already written in the composer so the person reads it and sends it. It answers `false` when no chat can be
opened; the page then offers the sentence to copy. The call is guarded (the seam is absent without the core) and nothing is sent by the page itself.

## A row Creations took over

A plugin whose things are also listed in Creations declares a source there (`window.__KB_CREATIONS__`, [creation-sources.md](creation-sources.md)) and names the row it replaces with `foldsRow`.
The menu then leaves that row out **while the source is declared** (Apps is the row `tables`; Dashboards is a fixed row). The page stays reachable (Creations › the tile › a card, or
« Open the … page »), `window.__KB_OPEN__({ view: id })` still opens it, and the row's states (Kaby's suggestions waiting, a connection to make) show on the Creations row.

## Tests

`node packages/kybernos-plugin/test-business-menu.mjs` (the registry cut out of `client.js`, plus where the core reads it and the order of the fixed rows),
`node packages/kybernos-plugin/test-templates-seam.mjs` (the door, over fakes), and against the sandbox
`source scripts/sandbox/env.sh && node scripts/check-menu-business-live.mjs [--shots <dir>]` (the fixed order, no header, a fake row declared from the page, a row opens
its page and is the selected one, the icon rail, the row going away, and the template cards on Apps › New app).
