# kybernos-db

The engine for user- and agent-defined databases: objects (Tasks, Orders, Contacts…), typed fields, relations and views. It replaces the three fixed
engines (Contacts, Catalog, Pipeline) in phase A; "task management" is one more object, not a plugin.

This folder holds **lots 1 to 6: `core/`, the rules (no disk, no network, no clock), `store/`, the SQLite file with its journal, its saved views and its
attachments, `agent/` with `index.js`, the DSH bundle that gives the agents thirteen tools, a block of their system prompt and the `db-builder` skill, and the
page: `api.mjs` + `routes.mjs` (the host's door for it) and `client.js` (the « Tables » page), with the relations between tables and the files of a row edited from it.** The
replacement of the old engines (lot 7) comes next and imports these.

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
- **Links between tables (lot 5).** A link field points at rows of another table, one or many. In the drawer its rows are chips (each opens its row, an × takes the link off) and
  a picker (search, keyboard, Escape closes only the picker) adds one; a chip in a table or a board card opens the row too, and **Back** in the drawer returns to where the click was.
  The links are kept on one side only: the other table shows them under **Linked from**, computed by the host (`GET /kybernos-db/links?db=&object=&id=`), under the name the
  link was given (`inverse`, e.g. an order's Customer field seen from the customer as « Purchases ») or else the name of the table it comes from. A write refuses a link to a row
  that does not exist or is deleted (`link`); a row deleted afterwards leaves a dashed « Removed link » chip, and restoring it makes the link live again.
  **« How it's built »** (button under the tabs) lists the fields of each table with their links both ways, and draws the map of the links (a box per table, a line per link; a box opens its table).
- **Files (lot 6).** A field of files holds `[{ name, size, type, hash }]`; the bytes are kept next to the db (`dbs/<id>/blobs/<sha256>`), once per content. In the drawer each file
  is a picture (an image) or an icon, a link that opens it (a picture in a new tab, anything else as a download under its own name), its size and an ×; a box takes files chosen with the
  button or dropped, and says the cap before anything is tried. In the table the cell shows a thumbnail per image and a chip per other file (three at most, then a count), takes
  files dropped on it, and an × on hover or focus takes one off. A file over the cap (25 MB, or the field's `maxBytes`) is refused in the browser before a byte is sent, and again by the host
  (`POST /kybernos-db/upload?db=&object=&field=&name=&type=` takes the raw bytes as `application/octet-stream`, 413 over the cap by the announced length and by the bytes actually
  streamed). Taking a file off has an Undo that puts the list back. `GET /kybernos-db/file?db=&object=&id=&field=&hash=` serves a file **only to the row that holds it in that
  field** (a hash alone opens nothing), behind the same session and fence, through `serve-user-file.mjs` (DL-04: a person's file is never shown as a document in DSH's origin): its
  type comes from its first bytes, never from what the upload said, a PNG, JPEG, GIF or WebP is shown in place and everything else (a PDF, an SVG, a page) is a download, always with `nosniff`
  and a closed content-security-policy (`scripts/test-serve-user-file.mjs` keeps the copy identical to the other bundles').
  **Garbage collection:** the first time a db is opened in a process, a file that no row holds (deleted rows count as holding) and that is older than 7 days (`GC_GRACE_MS`) is
  deleted; storing the same bytes again renews the file's age, so a file uploaded before its row is written, or taken off with an Undo pending, is never caught. For the agent a
  protected field of files is protected like any other: its value is masked, its names are not searchable, a write to it asks the person; a secret one is not even a key.
- **The toolbar.** The page's controls ride in the product's toolbar as its `trailing` slot (the toolbar's own `views` prop already means the view modes of the old pages);
  without a toolbar handed over, the same controls sit in a bar of their own.

Tests: `test-routes.mjs` (every route behind the session), `test-client.mjs` (the pure parts, the registration, each piece rendered to a plain tree) and, against the
sandbox, `source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-tables-live.mjs [--shots <dir>]` (the real page over a real db: each control
saved and read back from the host, Kaby's change with Undo, an order linked to a customer and products and opened both ways, an image and a PDF dropped on a cell and chosen in the drawer and served back byte for byte, a file over the cap, an Undo, a failing host, 420 px, the console). `scripts/lib-tables-seed.mjs` builds the three dbs it opens (Home, Shop and Papers). After a restart of the sandbox, `node scripts/check-tables-files-after-restart.mjs` finds the files the run attached again.

## What is not here yet

Removing or renaming an object or a field and changing a field's type (only adding is possible), creating a row from a link picker, a preview bigger than a thumbnail, dropping a folder, sync with the server, and team rights
(`can()` refuses everyone but the owner, and the store does not call it: the door that calls the store does).
