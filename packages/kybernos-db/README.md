# kybernos-db

The engine for user- and agent-defined databases: objects (Tasks, Orders, Contacts…), typed fields, relations and views. It replaced the three fixed
engines (Contacts, Catalog, Pipeline), which no longer exist; "task management" is one more object, not a plugin. A sector template ships its trade as a ready database
(« Templates », below).

This folder holds **`core/`, the rules (no disk, no network, no clock), `store/`, the SQLite file with its journal, its saved views and its
attachments, `agent/` with `index.js`, the DSH bundle that gives the agents sixteen tools, a block of their system prompt and the `db-builder` skill, the
page: `api.mjs` + `routes.mjs` (the host's door for it) and `client.js` (the « Apps » page), with the relations between tables and the files of a row shown on it, and the
templates (`template.mjs`, `instantiate.mjs`), and `remote/`, what moves an app between a computer and a team space and keeps it there (« Moving an app » and « Publish », below).**

```bash
node packages/kybernos-db/test-agent.mjs && node packages/kybernos-db/test-host.mjs && node packages/kybernos-db/test-routes.mjs && node packages/kybernos-db/test-client.mjs && node packages/kybernos-db/test-remote.mjs && node packages/kybernos-db/test-publish.mjs
```

The agent tests were checked by 35 mutations (a secret field shown, a mask that leaks, a protected value that can be searched, a lowering allowed, a view that
loses its owner, an approval that is never registered, a database left open when the bundle goes…): every one makes a check fail.

## The page

The Apps row of the menu (row `tables`, `client.js`). The page opens on a **gallery**: one card per app (its tables with their row counts, a monogram on a hue only that app has);
the ⋯ of a card opens it, asks Kaby about it or puts it away. An app opens on **one tab per table**, with **Relations** after them when it has more than one (the map of the links, and the same as a list).
For the table on screen, a bar with its **views** (table, board, cards, calendar, map) and the menus **Fields** (which to show), **Filter** (a tree of conditions, « and » / « or », groups),
**Sort** (up to three) and **Modify view**. **Nothing is edited by hand in Kybernos**: a row opens in a read-only drawer, and every change of data is Kaby's (**Ask Kaby** opens a new chat that already knows
the app, the table, the view or the row). What the page does save is how a table is *shown* (450 ms after the last change, to `POST /kybernos-db/view`); a table always keeps at least one view.
A secret field is never in the page text.

**Archive and delete.** The ⋯ of an app (or of a table, under the app's menu) archives: it leaves the apps and Kaby stops seeing it, nothing is deleted, and it can be restored. Only an
archived app or table can be deleted for good, from the « Archived » fold: the dialog says what disappears (tables, rows, links, files, views and, for a table, which links to other tables are cut,
from `GET /kybernos-db/impact`) and waits for the exact name to be typed. `POST /kybernos-db/app { db, object?, op: archive | restore | delete, confirm? }` is the door; an app that is
published refuses both (`published`).

**Templates.** When the core publishes `window.__KB_TEMPLATES__` (`list()`, `add(id, { sample, kit })`) the new-app screen offers the trade templates; without it that section is not drawn.

- **Cards with a cover, board totals.** A cards view with `cover: true` puts the first picture of a row (the first attachment field that holds an image) on top of its card, a gallery
  of properties or products; without it the picture is the card's small avatar, and a row with none keeps its initial. Each column of a board adds up the first money field that is shown and
  not protected (a column of unpriced rows says nothing). The person does not toggle the cover yet: a template or Kaby (`view_save`, `cover`) sets it.
- **Map.** A map view (`kind: 'map'`, `lat`, `lng`: two number fields, latitude and longitude in degrees) puts each row on a real map: MapLibre GL, vendored under `vendor/` and served
  at `/kybernos-db/vendor/maplibre-gl.js|css` (loaded only when a Map view opens), OpenFreeMap tiles restyled to the page's colours (`plugin.json` declares `net:tiles.openfreemap.org`; tiles are
  fetched without credentials or referrer). A pin is the price (the first money field) or the title; pins close together fold into a count by zoom; a pin opens its row in the drawer and the open row's pin
  lights up. When the library or the tiles cannot load, the view falls back to a drawn schematic map with the same pins. A row without a valid latitude and longitude is left off the map and counted
  in the caption. `view_save` takes `kind: 'map'` with `lat` and `lng` (guessed from the field names when left out).
- **Kaby changes a view.** The page asks `/kybernos-db/state` every 3 s (not while the tab is hidden); a view whose stamp (`rev`, `by`) moved by the agent while the person
  has no edit waiting is announced with a toast and an Undo, which puts the view back as it was (the host then records the person's hand).
- **« Modify view » and « Ask Kaby… »** hand a sentence to the chat through `window.__KB_ASK__` (the core's `kbStartChatText`: the draft is written, the person sends it);
  without the seam the sentence is offered to copy. Kaby's tool for it is `view_save`: a view is what you see, never the data or the structure.
- **The host's door.** `GET state` (each db also says the template it came from, `template`, so that a shipped dashboard can name its data by that id), `GET records`, `POST write` (create, update, delete, restore) and `POST view` (save, remove), all behind DSH's signed session cookie
  and the host fence (`session-guard.mjs`, a copy of the shared shape), a 64 KB body cap, and the core served at `/kybernos-db/core/<file>.mjs` so the page applies
  the very rules the host does (the shared vector cases keep the two in step).
- **Links between tables (lot 5).** A link field points at rows of another table, one or many. In the read-only drawer its rows are chips (each opens its row, **Back** returns to where the
  click was); a chip in a table or a board card opens the row too. The links are kept on one side only: the other table shows them under **Linked from**, computed by the host
  (`GET /kybernos-db/links?db=&object=&id=`), under the name the link was given (`inverse`, e.g. an order's Customer field seen from the customer as « Purchases ») or else the name of the
  table it comes from. A write refuses a link to a row that does not exist or is deleted (`link`); a row deleted afterwards leaves a dashed « Removed link » chip, and restoring it makes the link
  live again. The **Relations** tab of an app draws the map of the links (a box per table, a line per link; a box opens its table) and lists them.
- **Files (lot 6).** A field of files holds `[{ name, size, type, hash }]`; the bytes are kept next to the db (`dbs/<id>/blobs/<sha256>`), once per content. In the read-only drawer each file
  is a picture (an image) or an icon, a link that opens it (a picture in a new tab, anything else as a download under its own name) and its size. In the table the cell shows a thumbnail per image
  and a chip per other file (three at most, then a count). The page no longer adds or takes files off: Kaby does. A file over the cap (25 MB, or the field's `maxBytes`) is refused by the host
  (`POST /kybernos-db/upload?db=&object=&field=&name=&type=` takes the raw bytes as `application/octet-stream`, 413 over the cap by the announced length and by the bytes actually
  streamed). `GET /kybernos-db/file?db=&object=&id=&field=&hash=` serves a file **only to the row that holds it in that
  field** (a hash alone opens nothing), behind the same session and fence, through `serve-user-file.mjs` (DL-04: a person's file is never shown as a document in DSH's origin): its
  type comes from its first bytes, never from what the upload said, a PNG, JPEG, GIF or WebP is shown in place and everything else (a PDF, an SVG, a page) is a download, always with `nosniff`
  and a closed content-security-policy (`scripts/test-serve-user-file.mjs` keeps the copy identical to the other bundles').
  **Garbage collection:** the first time a db is opened in a process, a file that no row holds (deleted rows count as holding) and that is older than 7 days (`GC_GRACE_MS`) is
  deleted; storing the same bytes again renews the file's age, so a file uploaded before its row is written, or taken off with an Undo pending, is never caught. For the agent a
  protected field of files is protected like any other: its value is masked, its names are not searchable, a write to it asks the person; a secret one is not even a key.
- **The toolbar.** The page's controls ride in the product's toolbar as its `trailing` slot (the toolbar's own `views` prop already means the view modes of the old pages);
  without a toolbar handed over, the same controls sit in a bar of their own.

**Publish.** When the host offers a hosting (below), an app's header and the ⋯ of its card get **Publish…**: a card says what goes (tables, rows, files, size), lists the `personal` fields that travel, refuses an app with a
`sensitive` or `secret` field by naming them, and asks **where it runs**: the person picks one of their own cloud computers (name, region, running or sleeping, « always on » only when the hosting says so), and a small
**Get another cloud computer** button opens their Kybernos server to order one (an `https` address the hosting gave; no address, no button). With no computer the card shows only that button. Publish never creates a computer.
A published app shows a pill with the computer it lives on, a note under its tabs (that computer, how fresh the copy kept here is, and why the structure is locked), **Open web app** (a new tab, signed in by a one-time link
the host makes) and **Unpublish…**; if its computer was deleted the pill and the note say so and the only way out is to keep the local copy; Archive is shown locked with the reason. While an app is published the filters, sorts and field choices of a view still work **for the visit only**: they are never saved, because the saved views are the web app's. With no hosting the page shows none of this.

Tests: `test-routes.mjs` (every route behind the session), `test-client.mjs` (the pure parts, the registration, each piece rendered to a plain tree) and, against the
sandbox, `source scripts/sandbox/env.sh && scripts/sandbox/start.sh && node scripts/check-apps-live.mjs [--shots <dir>]` (the real page over two real dbs: the gallery, an app and its
tabs, Relations, the archive / restore / delete round trip read back from the host, a narrow width, the console) and `scripts/check-db-templates-live.mjs` (the three template dbs opened
from their cards). `scripts/lib-tables-seed.mjs` builds the dbs they open (Home and Shop).

## Templates

A trade's template (the themes under `packages/kybernos-plugin/themes`) can ship a ready database, so a person starts with a shop, an agency desk or a recruitment board
instead of an empty page. The bundle owns the point `kybernos/db#template` (`template.mjs`): `db/<id>.json` holds the objects, fields, links and saved views with every label
as an `{ en, fr }` pair; `demo/db-sample.json` holds the sample rows, which link to one another by `ref` and name their pictures (`{ "photo": "<theme folder>/<name>" }`, a file of
the theme's `demo/photos`). The point is inert data: the rows live apart, so an agent that reads a contribution never reads a person.

`instantiate.mjs` makes the database through the same store calls the tools use: the structure first, then the views, then the rows (a link to a row not made yet is set once both
exist), then the pictures as blobs. The person's language picks the labels, and the database keeps plain strings from then on. Everything is checked before the first write; a
failure half way removes the half-made database. `<DSH home>/kybernos/kybernos-db/templates.json` remembers which database each template made, so installing twice changes nothing.

The core reaches it through the seam `globalThis[Symbol.for('kybernos.db')]` (`{ version: 1, install({ template, sample, lang, photo }) }`), published while the bundle is on; the
Themes route calls it from its `seed` action. Tests: `test-template.mjs`, `test-instantiate.mjs`, and the seam in `test-host.mjs`.

## Putting away and deleting

A table, or a whole database (an « app »), is **archived** before it can go: `db.archiveObject(key, by)` / `db.restoreObject(key, by)` and `db.archive(by)` / `db.unarchive()`. An archived
table keeps its records and its history, leaves `db.objects()` (`{ all: true }` lists it with `archived: { by, at }`) and takes no write until it is restored (code `archived`); an archived
database does the same for every table, is flagged in `registry.list()` and `db.info()`, and is no target for a call that names none. Deleting for good is a second step and only works on what is
archived: `db.deleteObject(key, by)` drops the table, its records and history, its views and the files only it held, and **cuts the link fields that pointed at it** from the other tables (their
column, their place in the views, their values in the journal; an update that only touched such a link leaves the history, and `rev` and the stamps follow), so `verify()` stays true.
`registry.remove(id)` removes an archived database's folder, attachments included; `service.remove(id)` also closes it and asks the host's `ports.published(id)` whether the app is still published.

Rights: `can()` has `schema.archive` (Kaby asks the person, with a card) and `schema.delete` (the person's alone, Kaby is refused). The agent has `db_archive` and `db_restore` (restore is free); it has
no tool to delete for good, by design.

## Profiles and the door

An app can carry **profiles**, the rules a team member works under once it is shared (`core/profiles.mjs`, kept in the app's own catalogue by `db.setProfiles(list, by)` / `db.profiles()`, so the page, the agent and the hosted app read the same data;
a template ships them as `profiles` in `db/<id>.json`). A profile is `{ id, label, grants }` and a grant is `{ object, do, fields? }`: additive and **default-deny**, a table only where it has a grant, `do` a list of `read`, `create`, `update`
(**`delete` is not a verb**: a member never deletes, restores or changes the structure, whatever a profile says), `fields` mapping a field to `hidden`, `read` or `write`. A `normal` field follows the grant, a `personal` one is hidden until
named, a `sensitive` or `secret` one is always hidden. The owner is built in (`owner` is a reserved id). The e-commerce template ships **Team member**: reads and edits orders, notes and contacts (email read-only, nothing deleted), reads
products and edits their stock.

`can(actor, action, resource)` answers for a member too (`{ kind: 'member', role, profile }`, `resource.object`, `resource.field`); `api.as(actor)` is the door that asks it **on every call**: the owner gets the door the page uses, a member
gets lists without the tables they have no grant for and without any hidden field, writes refused field by field (`forbidden`, with the reason) and journalled as `member:<id>`, no view, no archive, no delete; anything else gets a door that refuses
everything. The profile is read from the app by the member's role, never from the request. `test-door.mjs` is the rights matrix over a real db built from the e-commerce template; `vectors/rights.json` holds the shared cases for any other implementation.

## Moving an app (`remote/`)

The hosted team space (`packages/kybernos-webapp-creator/templates/tables`) and the computer that owns an app speak through three small modules that do not depend on either side. They are vendored into the hosted app with the door (`scripts/build-tables-app.mjs` lists them), and the DSH side reads the same files.

- **`remote/token.mjs`** (pure, `node:crypto` only): signed, expiring tokens (`signToken`, `verifyToken`: the kind is inside the MAC, the signature is checked in constant time before the claims are read) and the **owner's API token**, `mintOwnerApiToken` / `verifyOwnerApiToken`: kind `owner-api`, signed with the space's boot key, issue time inside, five minutes at most (the verifier checks the lifetime the token claims, so a token minted for an hour is refused). `bearerOf(header)` reads an `Authorization` header. The team space used to carry its own copy; there is one now.
- **`remote/bundle.mjs`** (pure: Buffers in and out): one binary container for a whole app. `encodeBundle({ db: { id, name, fingerprint, bytes }, blobs: [{ hash, bytes }] })` and `decodeBundle(bytes, { maxBytes })`, `checkManifest(manifest)` for the same rules on a manifest that arrives alone. Layout: the magic `KBAPPBND`, the format (1), the manifest's length, the manifest (JSON: `format`, `db: { id, name, size, sha256 }`, `fingerprint`, `blobs: [{ hash, size }]` in ascending order of hash), the SQLite file, then each attachment. The reader trusts nothing: every key of the manifest, the sizes against the bytes actually there (short and long are both refused), the SQLite header, every hash recomputed and compared, a cap on the whole (256 MiB unless the caller says otherwise); a name or a path never comes from the input (an attachment is named by the SHA-256 of what it holds, a db by its ULID). Answers are `{ ok: true, … }` or `{ ok: false, code, message }`.
- **`remote/snapshot.mjs`** (disk, `node:sqlite`): `snapshotDb({ db, tmpDir })` takes a consistent copy of a **live** db with SQLite itself (`db.backup(file)` is `VACUUM INTO`: it reads through the WAL while writers carry on, and never copies a file that is being written) and, in the same synchronous stretch, the fingerprint and the list of attachments the rows hold, so they describe one moment; `manifestOf` and `bundleOf` make the manifest and the whole bundle of it. `stageBundle({ decoded, tmpRoot })` lays a decoded bundle out as `<tmpRoot>/in-xxxx/<db id>/{db.sqlite, blobs/}` and proves it (SQLite's quick check, it opens as a Kybernos db no newer than this one, and its id, name and fingerprint are the manifest's); the caller moves the folder into place with one `rename`.

Two small additions to the store serve it: `db.backup(dest)` and `db.referenced()` (the hashes of every file a record still holds, deleted records included). `test-remote.mjs` covers the three modules, with hostile bundles (truncated, an oversize header, a duplicated or unordered blob, a hash that does not match, trailing bytes, a db that is not the one the manifest names).

## Publish (`remote/`, DSH side)

Publish puts an app into a **team space**, one small web app per cloud computer of the person that holds any number of published apps. From then on the hosted copy is the truth and the folder on the computer is a read-only **mirror** of it.
The decisions are in `docs/etudes/2026-10-31-share-as-app-cadrage.md`; what the space's host has to provide is `docs/dev/apps-hosting-port.md`.

- **`remote/hosting.mjs`: the port.** The plugin never talks to a billing system or a cloud: it asks an object the host process hands over (`apply(ctx, { remote: { hosting } })`) whether Publish `available()`, `describe()`s it
  (`name`, and `orderUrl`, the `https` address that orders another computer, never built or changed here), lists the person's `hosts()` (id, name, state, region, `alwaysOn`, `shared`; read when the dialog opens, never on a state read; none is a
  valid answer) and asks `ensureSpace({ host })` for the space on the one they chose (`{ id, url, bootKey }`). **The default is "not available"**: a product with no hosting shows no Publish button. `alwaysOn` is the only source of the
  words « always on », and only when it is `true`. `envHosting(env)` is a development adapter (`KYBERNOS_DB_SPACE_URL`, `KYBERNOS_DB_SPACE_KEY`, optionally `KYBERNOS_DB_ORDER_URL`, read once at start, never from a request) that lists
  that one space as the one computer; it is how the checks run.
- **`remote/cloud-hosting.mjs`: the real hosting.** A DSH signed in to a Kybernos account lists the person's cloud computers of the active workspace and publishes onto the chosen one through the cloud bundle's seam
  (the account token never reaches this bundle; manifest permission `account`). `available()` is « yes » only once the server answered the list, so a server that does not host web apps (or a member who may
  not publish) shows no button. Details, codes and the one known limit (one workspace at a time) are in `docs/dev/apps-hosting-port.md`.
- **`remote/registry.mjs`**: `<DSH home>/kybernos/kybernos-db/published.json` (mode 0600, written whole or not at all) holds each space (its id, origin, boot key and the id of its computer) and the apps published into it (with the computer's id and the last name and region seen for it), and the computer the last Publish used (only the default choice of the next dialog). The boot key is in no state, log, error or prompt.
- **`remote/space.mjs`**: the owner's client of a space (bundle, fingerprint, snapshot, blobs, write, upload, release, the one-time link), authenticated with a five-minute owner token minted per request from the boot key.
  Every call answers `{ ok, … }` or `{ ok: false, code, message }` and never throws; a response body is never repeated in an error.
- **`remote/mirror.mjs`**: pulls manifest → database → only the missing files, recomputes every hash and size, stages the result and swaps it in atomically; a failed pull never damages the mirror.
- **`remote/publisher.mjs`**: the one place that makes an app published. `check` (the card's facts and the computers), `publish` (onto a computer read in `hosts()` just before, else `unknown-host`; atomic: nothing is registered before the hosted copy's fingerprint matches the one sent, a failure after the upload releases it, an
  upload that cannot be released is remembered and taken out first next time), `unpublish` (pulls the hosted copy one last time, checks it is what this computer holds, releases it, deregisters; if the space cannot be reached it says so
  and offers *keep my local copy and forget the hosted one*, behind the app's typed name), `openWeb` (the ten-minute one-time link, a secret that is never kept), `refresh` and the poll (30 s, unref'd, one in flight per app, backoff up to 5 min;
  the state says `lastSync` and `syncError`), and the writes. One publish or unpublish per app at a time. An app is `hostGone` only when it could not be reached **and** a `hosts()` that succeeded no longer lists its computer
  (asked at most once a minute; a failed `hosts()` proves nothing). Moving an app is Unpublish, then Publish.
- **`remote/facade.mjs`**: what `service.resolve` hands out for a published app. Reads and `list` come from the mirror; every write, view, profile, archive, delete or structure change is refused with code `published` and a plain
  "unpublish first" message (the agent's approval gate does not even ask). A row write (create, update, delete, restore, upload) goes to the web app as the owner and is awaited, and the mirror is refreshed before the answer returns.
  `api.mjs` stays synchronous; `routes.mjs` forwards `write` and `upload` for a published app and mounts five more routes only when a publisher exists: `GET publish-check`, `POST publish`, `POST unpublish`, `POST open-web`, `POST refresh`.
  `GET state` gains `hosting` (`{ available, name }`) and, per app, `published: { slug, url, since, lastSync, syncError, host: { id, name, region } | null, hostGone } | null`.

Tests: `test-publish.mjs` (the publisher, the mirror, the facade and the routes against an in-memory space, `lib-space-test.mjs`, with failures made on purpose) and `scripts/check-publish.mjs` (the same against the real hosted app
built from `templates/tables`, booted on a free port: publish, member writes, files, the poll, a killed and restarted server, a simulated restart of DSH, Unpublish and the forget path, and a scan of everything it printed for the key).

## What is not here yet

Removing a single field or renaming an object or a field, and changing a field's type (only adding is possible), creating a row from a link picker, a preview bigger than a thumbnail, dropping a folder, sync with the server beyond what Publish does (an app is written in one place at a time), row rules
(a member sees every row of a table they may read), and a way to edit profiles from the page or from Kaby (a template ships them today). For Publish: a real `hosting` that lists the person's cloud computers and starts the app on the chosen one
(until one exists nothing in the product offers Publish), moving an app from one computer to another in one step (today: Unpublish, then Publish), a way to freeze writes on the space between Unpublish's last check and its release, the journal saying `agent` for an agent's hosted writes (it says `person`), and the real
domain for the `net:` permission (a placeholder is declared). The store does not call `can()`: the door that calls the store does.
