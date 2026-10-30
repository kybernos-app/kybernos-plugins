# kybernos-pipeline

Orders, deals or candidates as cards on a board that moves from stage to stage, with the stages a theme defines. One of the three business plugins
(Contacts, Catalog, Pipeline), all on the shared business base (`docs/dev/business-base.md`).

**Where.** The Business group of the sidebar, row Pipeline (the row and the page come from this plugin; the group is the core's, `docs/dev/business-menu.md`).

**One template at a time.** With several templates installed, the page offers the boards of the **active** one only, and the cards, the counts and the pickers (contacts, items) are its own
(`docs/dev/business-visuals.md`); the selector is in the Business group of the sidebar.

**Use.**
1. Without a theme the page shows one plain board: New, In progress, Done. A theme that extends `kybernos/pipeline#flow` brings its own boards (one file = one board: stages, how the
   value is counted, whether a card may link to a contact and an item); with several, a switcher appears above the board.
2. The bar at the top right is the product's own (handed to the page by the core as `props.toolbar`; a plain bar of the same pieces stands in without it): search (finds by title,
   detail, contact, linked item, source and tags), a star that keeps the cards you starred (kept in this browser), the views **Columns**, **List** and, when cards carry due dates,
   **Calendar**, the filter and sort button (stages with their counts, then priority, source and tags when cards carry them; moved in the last 7 or 30 days; board order, last moved, value, name),
   and the primary action. A strip under the title says how many cards the filters leave and clears them.
3. « New card » adds a card (so does the + of a column). Drag a card onto another column (it lifts and tilts, the column shows a slot, the card flies to its place and settles), or focus it
   and press the left or right arrow (a screen reader hears where it went), or use the arrow button on the card; in the list, pick the stage in the row. A card that changes column goes to the
   end of the new one; the count and the total of each column follow, in the theme's format (money with its currency, or a plain number).
4. Click a card (or press Enter on it) to edit it, link it to a contact and to a catalog item, or archive it. « Archived » lists the archived cards and restores them.
   A card shows the contact's avatar, a drawing of the linked item, coloured chips (source, tags, due date: warm within three days, hot when past), a priority dot, how long it has been in its column and a progress bar along its stages.
5. Cards marked « demo » are the sample rows of a theme; « Clear sample data » removes them from every business page at once and keeps what you made.

**For the agent.** `pipeline_list` (free: the boards, or one board with its columns and cards) and `pipeline_move` (moves a card to another stage; DSH asks you to approve **each** move,
and the move is one line in the journal of the base, actor `agent`). No tool sends anything or reaches the network.

| | |
|---|---|
| Routes | `/kybernos-pipeline/` `flows`, `board`, `card`, `links` (GET) · `create`, `update`, `move`, `archive`, `restore`, `clear-demo` (POST). **Every** route, reads included, needs DSH's signed session (`session-guard.mjs`) |
| Data | the `flow_card` table of `<DSH home>/kybernos/business/donnees.sqlite`, reached through `globalThis[Symbol.for('kybernos.business')]` at request time; `{ ok: false, error: 'base_missing' }` without it |
| Boards | `kybernos/pipeline#flow` through `globalThis[Symbol.for('kybernos.registry')]`; a card whose board or stage the theme no longer defines is still shown (a generic board, an extra column) |
| Files | `pipeline-host.mjs` (the logic, pure, ports injected) · `pipeline-tools.mjs` (the two tools and the approval gate) · `index.js` (routes, wiring) · `client.js` (menu row and page) · `pipeline-flow.mjs` (the point's validator) |
| Tests | `test-pipeline.mjs` (the point) · `test-host.mjs` · `test-write-guard.mjs` · `test-client.mjs`; against a sandbox: `node scripts/check-pipeline-live.mjs` |
| Extras | A card may carry `fields` `{ source, priority: high|normal|low, due: YYYY-MM-DD, tags: [text] }` (the `flow_card.fields` column of the base). **The board route does not return `fields` yet** (`shapeCard` in `pipeline-host.mjs`): the page reads them when present and draws nothing otherwise; the Calendar view only exists once a card has a due date. |
| Kit | `window.__KB_BIZ_KIT__` (tags, avatars, drawings, icons, motion classes), read when drawing, with a plain fallback for each piece |
| Stores | nothing of its own; the browser keeps the board last shown (`localStorage`, optional) |
