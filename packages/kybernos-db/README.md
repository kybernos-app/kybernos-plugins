# kybernos-db

The engine for user- and agent-defined databases: objects (Tasks, Orders, Contacts…), typed fields, relations and views. It replaces the three fixed
engines (Contacts, Catalog, Pipeline) in phase A; "task management" is one more object, not a plugin.

This folder holds **lots 1 to 4: `core/`, the rules (no disk, no network, no clock), `store/`, the SQLite file with its journal, its saved views and its
attachments, `agent/` with `index.js`, the DSH bundle that gives the agents thirteen tools, a block of their system prompt and the `db-builder` skill, and the
page: `api.mjs` + `routes.mjs` (the host's door for it) and `client.js` (the « Tables » page).** Relations as links you can edit (lot 5), the attachment fields in the
UI (lot 6) and the replacement of the old engines (lot 7) come next and import these.

```bash
node packages/kybernos-db/test-agent.mjs && node packages/kybernos-db/test-host.mjs && node packages/kybernos-db/test-routes.mjs && node packages/kybernos-db/test-client.mjs
```

The agent tests were checked by 35 mutations (a secret field shown, a mask that leaks, a protected value that can be searched, a lowering allowed, a view that
loses its owner, an approval that is never registered, a database left open when the bundle goes…): every one makes a check fail.

## The page

Business › Tables (menu row `tables`, group `business`, `client.js`). One tab per table; for the table on screen, a bar with its **views** (table, board, cards, calendar), and
the menus **Fields** (which to show), **Filter** (a tree of conditions, « and » / « or », groups), **Sort** (up to three), **Modify view** and **New row**. Every view is
the person's to change and **every change saves itself** (450 ms after the last one, to `POST /kybernos-db/view`); a table always keeps at least one view. A row opens in a
drawer where each field saves when it is left; a secret field is a password input and is never in the page text.

- **Kaby changes a view.** The page asks `/kybernos-db/state` every 3 s (not while the tab is hidden); a view whose stamp (`rev`, `by`) moved by the agent while the person
  has no edit waiting is announced with a toast and an Undo, which puts the view back as it was (the host then records the person's hand).
- **« Modify view » and « Ask Kaby… »** hand a sentence to the chat through `window.__KB_ASK__` (the core's `kbStartChatText`: the draft is written, the person sends it);
  without the seam the sentence is offered to copy. Kaby's tool for it is `view_save`: a view is what you see, never the data or the structure.
- **The host's door.** `GET state`, `GET records`, `POST write` (create, update, delete, restore) and `POST view` (save, remove), all behind DSH's signed session cookie
  and the host fence (`session-guard.mjs`, a copy of the shared shape), a 64 KB body cap, and the core served at `/kybernos-db/core/<file>.mjs` so the page applies
  the very rules the host does (the shared vector cases keep the two in step).
- **The toolbar.** The page's controls ride in the product's toolbar as its `trailing` slot (the toolbar's own `views` prop already means the view modes of the old pages);
  without a toolbar handed over, the same controls sit in a bar of their own.

Tests: `test-routes.mjs` (every route behind the session), `test-client.mjs` (the pure parts, the registration, each piece rendered to a plain tree) and, against the
sandbox, `source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-tables-live.mjs [--shots <dir>]` (the real page over a real db: each control
saved and read back from the host, Kaby's change with Undo, a failing host, 420 px, the console). `scripts/lib-tables-seed.mjs` builds the db it opens.

## What is not here yet

Removing or renaming an object or a field and changing a field's type (only adding is possible), the check that a relation points at a
real record, editing a relation or an attachment from the page (read-only chips and a list for now), sync with the server, the garbage collection of blobs, and team rights
(`can()` refuses everyone but the owner, and the store does not call it: the door that calls the store does).
