# The sidebar menu and the page registry

The menu is **fixed**: Dashboards, Automations, Connectors, Skills, Agent Teams, Apps, Creations. There is no « Business » group header, no
Templates row and no Overview row (the sector dashboard is reached from Dashboards). The core knows no business plugin by name; Apps is the one row a
plugin declares today (`kybernos-db`, row id `tables`). Four seams, all in `packages/kybernos-plugin/client.js` (the pure parts are the blocks
`<kb-business-menu>`, `<kb-menu-entries>` and `<kb-menu-prefs>`, the drawing is `<kb-business-ui>` and `SalesMenu`). « Fixed » is the default: a person can hide, reorder and rename
the rows in the Theme page (section 4).

## 1. Declare the row

```js
const off = window.__KB_MENU__ && window.__KB_MENU__.register({
  id: 'tables',                // 2-24 lower-case letters, digits, dashes; never the id of a page of the core
  group: 'business',           // the only group (a registry key, not a header anyone sees)
  icon: 'grid',                // a name of the core's icon table (unknown: a neutral icon is drawn)
  labelKey: 'business.apps',                     // a key of the core's dictionary…
  label: { en: 'Apps', fr: 'Apps' },              // …and/or the plugin's own words (`en` is required; fr, es, ar optional)
  order: 40,                   // optional, -1000..1000, default 100; ties keep the order of declaration
  defaultShown: false,         // optional, default true: `false` = the DEFAULT menu leaves the row out (the page stays mounted; Theme › Menu lists the row, switched off)
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
- A row can ask for attention: `window.__KB_MENU_STATE__.set('<id>', { review: n, need: n, running: bool })` draws the same ring and dot as the other rows. When the row is folded into Creations (a Creations source with `foldsRow`), the dot is drawn on the Creations row and, for `review`, it says which source and how many ("1 suggestion is waiting for you in Dashboards", `menu.review.src`); a tap on the dot opens the folded page, a tap on the row opens Creations.

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

## 4. The person's arrangement

The rows above are the **default** menu. A person can hide, reorder and rename them in the Theme page (Menu); the menu only reads the result.

- **Stored by the Theme page, read by the menu.** `localStorage['kybernos.theme.menu.v1'] = { v: 1, updatedAt, menu }` where `menu` is a menu document, or `null` for the default menu.
  Only the Theme page writes it. The menu reads it synchronously at each draw (`kbMenuPrefsRead`: first paint has it, a damaged value is the default menu, it never throws) and redraws on the
  `window` event `kb-menu-prefs-change` (the Theme page sends it after each write) and on the `storage` event of that key (another window).
- **The document**: `{ entries: [{ id, shown, order, label? }], unlisted: 'show' | 'hide', locked }`. `kbMenuPrefsClean` puts any value back in that shape (or `null`): ids like a row id,
  never `workspaces projects settings account`, at most 24 entries, a duplicate id counts once, `order` renumbered 0..n-1, a `label` per language (`en fr es ar`, 1 to 40 characters, no `<` `>`).
  Two other copies exist (`kybernos-theme`: `preset-store.mjs` and the page); each package's test pins the same vectors.
- **The rule** (`kbMenuArrange`): a listed row is shown or hidden by its entry and goes first, by `order`; a row that is not listed keeps its default order after them, and is hidden when
  `unlisted` is `hide`. A row declared with `defaultShown: false` (`off: true` on the arranger's rows) is left out of the default menu and of every arrangement that does not list it: only an entry
  with `shown: true` brings it in (the Front desk is the one such row today). An entry for a row this install does not draw does nothing. `locked` does not change what is drawn: it only tells the Theme page that an app set the arrangement.
  Workspaces, Settings and the account are drawn by the host, are not rows here, and cannot be hidden.
- **The name** of a row: the person's `label` in the page language, else the default name: Kaby's own name for its row, the field's word (fixed rows only: no pack renames a declared row), else the
  dictionary's (`kbMenuDefaultName`). Never the label of another language.
- **The registry** the Theme page reads: `window.__KB_MENU_ENTRIES__ = { v: 1, list(), subscribe(fn) -> off, hook: 'data-kb-row' }`. `list()` gives the rows this install draws right now, in the default
  order, as frozen `{ id, icon, name }` plus `off: true` on a row the default menu leaves out (`icon` is the icon-set entry of `window.__KB_ICONSETS__`, or `null` for `documents` and the declared rows). It comes from the same flags the menu draws with
  (`kbMenuFlags`, plus the declared rows a Creations source does not fold), so the page cannot offer a row the menu does not have. `subscribe` fires when a plugin declares or drops a row or a
  Creations source folds one. The default order, the icon-set entry, the line icon of the classic set and the name key of each fixed row are ONE table, `KB_MENU_FIXED`.
- **The hook**: every row button carries `data-kb-row="<id>"`. Find a row by it, never by its translated label.

- **Two more surfaces.** The document may carry `surfaces: { secondary?, settings? }` (the account menu, the Settings pages), each `{ entries: [{ id, shown, order }], unlisted }`, cleaned by the same
  three copies (`KB_MENU_SURFACES` in `kbMenuPrefsClean`). `list('secondary')` and `list('settings')` of the registry give frozen `{ id, icon: null, name, locked }` (settings: also `group`, `groupName`);
  `hooks` says what each is hidden by: `data-kb-row` (rows), `data-kb` (the account menu's `menu-<id>` items) and `data-kb-t` (the Settings nav cells: the plugin writes the normalised title
  from the cell's React key, `KB_NAV_KEYS`). `kbSurfaceCss` turns the document into a style (`#kb-surfaces-css`, `data-kb-surfaces="on"` on `<html>`), never by a label. A Settings page rule ends in `:not(#kb-surfaces-css)` for its weight only (an id no cell has): at a phone's width the Mobile bundle's flat list shows every cell with a five-attribute `display: flex !important` rule, which a plain `[data-kb-t]` rule loses to (found live on the phone's Simple Settings, 2026-11-22). In Kaby mode the document is
  the locked Simple preset (`window.__KB_THEME_LOCKED__`), not the person's own, **for all three surfaces: the main menu's rows too** (SalesMenu follows `kbSurfaceDoc`, the phone's drawer is the real sidebar, 2026-11-22). The preset names real registry ids (`kyber`, `tasks` shown as « Reminders », `connectors` shown as « Apps »). When the preset cannot be read the document is `null` and nothing is filtered: Simple shows the full app unfiltered. A page or an item you add must be put in `KB_SECONDARY_ENTRIES` / `KB_SETTINGS_PAGES` (the test
  checks them against the real footer card and `KB_NAV_KEYS`) to be offered.

A plugin that declares a row (section 1) gets all of this for free; it adds nothing.

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
`node packages/kybernos-plugin/test-menu-prefs.mjs` (the arrangement: sanitizer vectors, the synchronous read, the rule, the entry registry on every flag combination, and where `SalesMenu` reads them),
`node packages/kybernos-plugin/test-templates-seam.mjs` (the door, over fakes), and against the sandbox
`source scripts/sandbox/env.sh && node scripts/check-menu-business-live.mjs [--shots <dir>]` (the fixed order, no header, a fake row declared from the page, a row opens
its page and is the selected one, the icon rail, the row going away, and the template cards on Apps › New app).
