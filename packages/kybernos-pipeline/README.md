# kybernos-pipeline

Orders, deals or candidates as cards on a board that moves from stage to stage, with the stages a theme defines. One of the three business plugins
(Contacts, Catalog, Pipeline), all on the shared business base (`docs/dev/business-base.md`).

**Where.** The Business group of the sidebar, row Pipeline (the row and the page come from this plugin; the group is the core's, `docs/dev/business-menu.md`).

**Use.**
1. Without a theme the page shows one plain board: New, In progress, Done. A theme that extends `kybernos/pipeline#flow` brings its own boards (one file = one board: stages, how the
   value is counted, whether a card may link to a contact and an item); with several, a switcher appears above the board.
2. « New card » adds a card. Drag a card onto another column, or focus it and press the left or right arrow (a screen reader hears where it went), or use the arrow button on the card.
   A card that changes column goes to the end of the new one; the total of each column follows, in the theme's format (money with its currency, or a plain number).
3. Click a card (or press Enter on it) to edit it, link it to a contact and to a catalog item, or archive it. « Archived » lists the archived cards and restores them.
4. Cards marked « demo » are the sample rows of a theme; « Clear sample data » removes them from every business page at once and keeps what you made.

**For the agent.** `pipeline_list` (free: the boards, or one board with its columns and cards) and `pipeline_move` (moves a card to another stage; DSH asks you to approve **each** move,
and the move is one line in the journal of the base, actor `agent`). No tool sends anything or reaches the network.

| | |
|---|---|
| Routes | `/kybernos-pipeline/` `flows`, `board`, `card`, `links` (GET) · `create`, `update`, `move`, `archive`, `restore`, `clear-demo` (POST). **Every** route, reads included, needs DSH's signed session (`session-guard.mjs`) |
| Data | the `flow_card` table of `<DSH home>/kybernos/business/donnees.sqlite`, reached through `globalThis[Symbol.for('kybernos.business')]` at request time; `{ ok: false, error: 'base_missing' }` without it |
| Boards | `kybernos/pipeline#flow` through `globalThis[Symbol.for('kybernos.registry')]`; a card whose board or stage the theme no longer defines is still shown (a generic board, an extra column) |
| Files | `pipeline-host.mjs` (the logic, pure, ports injected) · `pipeline-tools.mjs` (the two tools and the approval gate) · `index.js` (routes, wiring) · `client.js` (menu row and page) · `pipeline-flow.mjs` (the point's validator) |
| Tests | `test-pipeline.mjs` (the point) · `test-host.mjs` · `test-write-guard.mjs` · `test-client.mjs`; against a sandbox: `node scripts/check-pipeline-live.mjs` |
| Stores | nothing of its own; the browser keeps the board last shown (`localStorage`, optional) |
