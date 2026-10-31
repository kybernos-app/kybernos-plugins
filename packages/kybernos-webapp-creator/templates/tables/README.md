# Tables app (stack: `tables`)

A **team space** for Kybernos Apps: one small Node process that holds several apps (kybernos-db databases) and lets the owner and a team use them. Hono routes, Better-Auth for who is signed in, and kybernos-db's actor-aware door (`api.as(actor)`) for what each person may do. The app's own profiles decide; this server only finds the actor.

```
session ─▶ user ─▶ role ─▶ api.as(actor) ─▶ the app's profile decides, on every call
                    │
                    ├─ owner            → as({ kind: 'person', role: 'owner' })
                    └─ a profile id     → as({ kind: 'member', role, id: <user id> })
```

A member has one role, a **profile id** (`member`, `viewer`, …). Each app answers from the profiles it holds itself; an app with no profile of that id shows them nothing (`403 no-profile`, and it is not in their app list). A member never deletes and never changes structure, views or the app: the door refuses it whatever the profile says.

## What is in the folder

| Path | What it is |
| --- | --- |
| `server.js` | The entry of the apps runtime: reads `PORT`, listens on `127.0.0.1`. |
| `app.mjs` | The routes (`buildApp`), the edge (Origin, CSRF, headers, limits). |
| `public/` | **The client**: `index.html`, `app.css`, `favicon.svg` and `js/*.mjs`. Plain files, no build step, no dependency (see *The client*). |
| `lib/assets.mjs` | The list of what `public/` serves (an allow-list, read once at start), with content types and ETags. |
| `lib/db.mjs` | **The only place that imports kybernos-db.** Looks in `vendor/kybernos-db/` first, then in `packages/kybernos-db/` of this repository. |
| `lib/bootstrap.mjs`, `lib/token.mjs` | The owner's one-time link and the signed tokens. `token.mjs` only re-exports kybernos-db's `remote/token.mjs`: one copy, shared with the side that mints the owner's API token. |
| `lib/bearer.mjs`, `lib/transfer.mjs` | The owner's API token (what an `Authorization: Bearer` header means) and the transfer routes: import an app from a bundle, snapshot it back, release it. |
| `lib/freeze.mjs` | « Refuse every write for now », asked by the server that hosts the space and kept in a file, so a restart keeps it (see *What the hosting server asks of the space*). |
| `lib/invitation.mjs`, `lib/people.mjs`, `lib/store.mjs` | Invitations, the owner's people calls, what is kept in `auth.sqlite` beside Better-Auth's tables. |
| `lib/safety.mjs`, `lib/ratelimit.mjs` | Origin, CSRF, headers, client address; the rate limiter. |
| `lib/html.mjs` | The server-rendered pages (`/people`, `/activity`, `/account`, `/privacy`, `/invite`, the notices): plain HTML that links `/app.css`, no script, no style attribute. |
| `lib/mailer.mjs` | The port that sends an invitation and its one adapter, Resend's HTTP API (`mailConfig`, `makeResendMailer`, the text of the e-mail). Configured by the environment only. |
| `lib/audit.mjs` | The activity log: an append-only table in `auth.sqlite`, written through one redacting function, pruned at 90 days; the sentences the page shows. |
| `lib/privacy.mjs`, `lib/account.mjs` | What a person can see, take and erase (their export, their erasure, the owner's export of an app) and the routes for it, the privacy page and the activity page and API. |
| `scripts/build-tables-app.mjs` | Copies the template and vendors kybernos-db into `vendor/kybernos-db/`. |
| `scripts/mint-link.mjs`, `scripts/add-app.mjs` | Mint the owner's link; put an app in the space (local run). |

## Run it locally

```bash
node packages/kybernos-webapp-creator/templates/tables/scripts/build-tables-app.mjs ~/tables-space
cd ~/tables-space && npm ci --ignore-scripts          # hono, @hono/node-server, better-auth, pinned
node scripts/add-app.mjs shop <path to a kybernos-db folder: <dbs>/<db id>/>
PORT=4410 node server.js &
node scripts/mint-link.mjs http://127.0.0.1:4410      # prints the owner's link: open it once
```

Data lives in `./data` (`KB_DATA_DIR`): `auth.sqlite`, `apps/<slug>/<db id>/db.sqlite` (kybernos-db's own layout, one app per slug) and, for a local run, `secrets.json` (mode 0600).

## Environment

| Variable | |
| --- | --- |
| `PORT` | Port to listen on (the apps runtime sets it). |
| `KB_HOST` | Address to listen on. Default `127.0.0.1`. |
| `KB_PUBLIC_URL` | Where people reach the app (`https://team.example.com`). Sets the one allowed Origin, the invitation links and `Secure` cookies. Without it the app answers to its loopback address. |
| `KB_AUTH_SECRET` | 32 to 256 characters. Signs sessions, CSRF tokens and invitations. |
| `KB_BOOT_KEY` | 32 to 256 hexadecimal characters. Mints the owner's link. |
| `KB_DATA_DIR` | Data folder. Default `./data`. |
| `KB_TRUST_PROXY` | `1` when a reverse proxy sets `x-forwarded-for` (rate limits then count per real client). |
| `KB_BUNDLE_MAX_BYTES` | The most an app bundle may weigh, in either direction. Default 256 MiB, 1 MiB to 2 GiB. |
| `KB_MAIL_API_KEY` | A Resend API key. Without it invitations are not sent by e-mail: the owner gets the link and passes it on (the default). Never logged, never in an answer. |
| `KB_MAIL_FROM` | The sender: `team@example.com` or `Name <team@example.com>`; required with the key, and a domain the provider has verified. |
| `KB_MAIL_REPLY_TO` | Optional address replies go to. |
| `KB_MAIL_API_BASE` | For tests: another base address for the provider. `https` only, or `http` to this very computer. |
| `KB_REGION_LABEL` | Words for where the space lives, shown on `/privacy`. Default: « the EU region your team space was created in ». Set it only to something true. |
| `KB_PRIVACY_CONTACT` | Who people ask about their data, shown on `/privacy` (an address becomes a mail link). Unset: « ask the owner of this space »; the page never makes an address up. |

A hosted run passes both secrets; nothing is written. A local run (the apps runtime passes no environment) gets them generated once into `data/secrets.json`.

## The owner

There is no public sign-up. The person who starts the app mints a link with `KB_BOOT_KEY` (`scripts/mint-link.mjs`): it lives 10 minutes and works once. `GET /open?t=…` creates the owner on first use, sets the cookie and redirects to `/` (the token leaves the address bar at once; `Referrer-Policy: no-referrer`). The link gives a password nobody knows, so the owner sets their own **once** with `POST /api/me/password {"password": "…"}`.

**Break-glass: no master password.** Lost the password? Mint another link: opening it signs the owner in again, ends every other session and allows one new password. Suspect the key? Change `KB_BOOT_KEY` and `KB_AUTH_SECRET` and restart: every session, link and invitation dies.

Link scanners that fetch URLs (mail gateways, chat previews) would spend a one-time link: hand the owner's link over directly, not through a channel that unfurls it.

## The owner's API token: moving an app in and out

The owner's own computer (DSH) talks to the space with no cookie: `Authorization: Bearer <token>`, where the token is a signed token of kind `owner-api` made with `KB_BOOT_KEY` (kybernos-db `remote/token.mjs`, `mintOwnerApiToken`). It carries its issue time and lives **five minutes at most** (the verifier checks the lifetime the token claims, so one minted for an hour is refused however fresh); the caller mints a new one for each request. A bearer request acts as the owner (`api.as({ kind: 'person', role: 'owner' })`), even before anybody has opened the first link: the first publish needs no browser.

- **Where it works**: the apps routes (`/api/apps…`, so the records, the writes and the files an app has), `GET /api/me`, and `POST /api/freeze` (below). Nowhere else: people, the password, the pages and sign-in answer a bearer `403 bearer-scope`.
- **What it skips**: Origin and the CSRF token, which defend a browser's ambient cookies; a bearer request has none. **What it does not skip**: the rate limit per client address (600 requests a minute, and 30 bad tokens in 15 minutes, then `429`), the body limits and the headers.
- **Cookies win**: a request that carries a cookie *and* a bearer is cookie-authenticated (Origin and CSRF apply, the session says who it is, the bearer gives nothing on top). A bearer that does not verify is `401` with `WWW-Authenticate: Bearer`, with or without cookies, and never falls back to the session.

The transfer routes, **owner only** (a member session is `403`, anonymous `401`), all under `/api/apps/:slug/`:

| Route | |
| --- | --- |
| `PUT bundle` | Imports a bundle (`Content-Type: application/octet-stream`) as a **new** app called `:slug` (the same slug rule as `scripts/add-app.mjs`). `409 exists` when the slug is taken, `409 db-exists` when the bundle's db is already in the space under another slug, `400 invalid-bundle` with a `code` (magic, version, truncated, trailing, manifest, hash, corrupt, not_a_db, db_newer, mismatch…) when it is not a good bundle, `415` for another content type, `413` over the cap. The cap is its own for this route (`KB_BUNDLE_MAX_BYTES`) and a body that announces more is refused before a byte is read. The bundle is checked whole (every hash recomputed, SQLite's quick check, the file opens as a Kybernos db and is the one the manifest names), written to `data/tmp/`, and moved into `apps/` with one `rename`: it happens whole or leaves nothing. `201 { ok, slug, db: { id, name }, fingerprint }`. |
| `GET fingerprint` | `{ ok, fingerprint }`: the db's change stamp, cheap. |
| `GET snapshot` | The app as one bundle (`application/octet-stream`, header `x-kb-fingerprint`). The db is copied by SQLite itself (`VACUUM INTO`, while the app is in use), never by copying the file; only the attachments the rows hold are in it. `413` when the app is bigger than the cap: use the pieces. |
| `GET snapshot/manifest` | `{ ok, format, db: { id, name, size, sha256 }, fingerprint, blobs: [{ hash, size }] }` of a snapshot taken now. |
| `GET snapshot/db` | The SQLite bytes of that snapshot (header `x-kb-fingerprint`; compare it with the manifest's, a write in between makes them differ). The snapshot is kept two minutes so the pieces of one pull describe one moment. |
| `GET blobs/:hash` | One attachment, as `application/octet-stream`. Only a 64-character lower-case hex hash is accepted (`400` otherwise); the name never comes from the request. |
| `POST release` | `{ "confirm": "<slug>" }` takes the app out of the space: its handles are closed and its folder deleted (renamed out of `apps/` first). Ends nothing else: no session, no member. |

The bundle is kybernos-db's `remote/bundle.mjs` (a magic, a manifest, the SQLite file, then each attachment, checked at both ends); the same code reads it on the owner's side.

## What the hosting server asks of the space

When the space runs on a cloud computer, the Kybernos server that hosts it talks to it with the same owner's token (never a person's session) and needs two things:

- **When a member last used it.** `GET /api/apps` with the token answers `{ ok, apps, last_request_at }`, the time (ISO 8601) of the last request made by a person with a session, so that the computer is not put to sleep in the middle of the team's work. The token's own calls, a request with no session and a page of the app that nobody signed in to do **not** count; a person asking for `/api/apps` is not told the time. It is kept in memory: a restart forgets it, and the field is absent until a member comes again.
- **A freeze.** `POST /api/freeze { "frozen": true | false }`, the owner's token only (a session, the owner's included, is `403`; a body that is not that is `400`), answers `{ ok, frozen }`. While frozen, every write is `503 { ok: false, error: "frozen" }` before anything reads the request: rows, files, structure, people and invitations, a release or an import, a sign-in and sign-out, and the owner's link (`/open`, which makes a session). Reads, the health check, the snapshot routes (how a restore or an Unpublish takes a last copy) and the call that lifts the freeze stay up. The state is the file `frozen.json` in `KB_DATA_DIR` (mode 0600): **it survives a restart**, a file that cannot be written is `500 unsaved` with the state unchanged, and a leftover file of any content means frozen.

The contract the server reads is in its own repository, `docs/contract/team-space-hosting.md`.

## People

Owner only, as JSON (`/api/people…`) and as a plain page (`/people`):

- list members and pending invitations; the profile ids come from the profiles the apps define (`owner` is never one);
- **invite by e-mail** or **by link** (no address; whoever holds it joins). With `KB_MAIL_API_KEY` set the e-mail really goes (below); without it nothing is sent and the link is shown to the owner;
- an invitation is a signed token naming a stored invitation (7 days, one use). What it gives is read from the stored row, so changing a pending invitation's profile changes what the link gives; **resend** makes a new link, kills the old one and sends it the same way. Once used, the invitation row is deleted with the address it held; one never used is deleted 30 days after it expires;
- change a member's profile; **remove** a member: their sessions end at once (their next request is `401`) and their account is **erased** (see *Privacy*).

### E-mail invitations

`lib/mailer.mjs` posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>`: one request, a 10 s timeout, no retry, no redirect followed, the key in that one header only. The answer is read out under the same timeout and **dropped**: only its status reaches the log (`mail: the provider answered 422`), never its words, so nothing the provider says can reach the owner, a log or the activity page. When the provider refuses, times out or cannot be reached, the owner is told `The e-mail could not be sent. Here is the link to give them yourself.` and gets the link; the same message and link on the people page. Plain text plus a small HTML part, in English: who invited, the space's name, the link, that it expires in 7 days and that it works once. No image, no tracking pixel, no remote resource, no script or style. **Click and open tracking must be off for the sending domain at the provider**: the e-mail carries none, but a provider can rewrite links.

The invitation limits are the same on every path (30 an hour for the owner), resend included. A bad setting (`KB_MAIL_FROM` missing or not an address, an `http` base) does not stop the app: it starts with the default mailer and logs which variable was refused, by name, never its value.

The invitee opens `/invite?t=…`, picks a name and a password (`POST /invite`, or `POST /api/invitations/accept`), and is signed in with the invited profile.

## Privacy: what people can see, take and erase

**The text on `/privacy` is a plain statement of what this app does, not legal advice. Have a lawyer review it, and the wording of your own purposes, before you rely on it. Nothing in the app claims legal compliance.** It is public, server-rendered with the same stylesheet, and linked from the sign-in screen, the invitation page, the rail and the footer of every page. It says who is responsible (the owner of the space; Kybernos runs the computer and the software), what is kept, where it lives (`KB_REGION_LABEL`), how long, and how each right is used here; the contact is `KB_PRIVACY_CONTACT` or « ask the owner of this space ».

| What | Where | Who |
| --- | --- | --- |
| A person's own data: name, address, profile, joined date, sessions as dates and a coarse device (« Chrome on macOS »; no token, no hash, no address) | `GET /api/me/export`, and « Download my data » on `/account` | any member and the owner |
| Delete my account: ends the sessions, erases the account, the password hash, the invitations made for the address and every trace of it in `auth.sqlite`; typed confirmation of their own address | `DELETE /api/me` `{ "confirm": "<address>" }`, and the dialog on `/account` (`POST /account/delete`) | members. **The owner cannot**: they export, then take the app out of the space |
| Remove a person: the same erasure | « Remove » on `/people`, `DELETE /api/people/members/:id` | owner |
| Everything of an app as JSON: the fields of every table, every record (archived ones carry a `deleted` stamp), the profiles, the list of files with names, types, sizes and hashes (the bytes are in the full copy) | `GET /api/apps/:slug/export.json` (attachment, `no-store`), « Export data » in the rail | the owner's **session** only: a bearer is refused (`403 bearer-scope`), it takes copies with the snapshot routes |

**What an erasure leaves, on purpose**: the rows of an app keep the opaque id of whoever wrote them (`member:<id>`), which after the erasure points at nobody; the activity log keeps that something happened, not to whom (the address is taken out of every row about the person and of every row that carries the same masked address). The erasure runs in one transaction, then the write-ahead log is checkpointed and the file rebuilt (`PRAGMA secure_delete`, `VACUUM`), so the old bytes are not left in free pages: the tests search every table **and the bytes of `auth.sqlite` and its log** for the address, the name, the hash and the tokens. What this does not reach: backups of the space, and whatever the hosting keeps (L6).

Sessions last 7 days (`session.expiresIn`, explicit), and no network address is kept in them. A name or an e-mail address cannot be changed by a person here: erase and be invited again.

### The activity log

`audit` in `auth.sqlite`, append-only (triggers refuse any `UPDATE` or `DELETE` of a row outside the one maintenance function), written through **one** function that redacts: it knows a fixed list of kinds, takes two opaque ids, a network address (kept only as a short keyed hash, so it cannot be recomputed without `KB_AUTH_SECRET`) and a few named details that each pass a check; an address is kept masked (`a***@example.com`) and only if it has the shape of one, so a password typed in the address box is dropped, not kept. No password, token, link or message body has a column.

Kinds: sign-in ok and failed (a masked address and a short network code, never the password), the owner's link opened or refused, password changed, invitation sent, resent, revoked, accepted or its profile changed, member removed, profile changed or self-deleted, exports downloaded (an app, a person's own data, a copy of an app), an app imported or released through the owner's token, and rate-limit refusals (one event per scope and network address every ten minutes, so a flood is one line). Kept 90 days, pruned at start and daily; capped at 100 000 rows so a flood cannot fill the disk. A log that cannot be written never stops a request, and one that cannot be set up never stops the app.

The owner reads it at `/activity` (a filter by kind, newest first, an « Older » link) and `GET /api/audit?limit&before&kind` (a member `403`, anonymous `401`, a bearer `403`): one human sentence per event, names from the people still in the team (`A former member` for the others), no address but a masked one.

## The client

The page a person uses is `public/`: `GET /` answers `index.html` to everyone, signed in or not; the page asks `/api/auth/get-session` and shows the sign-in form or the space.

- **Screens**: sign-in, a rail of tables, per table a **Table** tab (search, a filter on the first choice field, a stated sort), a **Board** tab (cards by the first choice field: drag and drop, and a status select in the row detail as the keyboard way), a **Relations** tab (the links between the tables the person can see, drawn, with a sentence per link), a drawer to add a row (inline validation, the door's own messages), a row detail (real `created`/`modified` stamps only: the door keeps no journal) that **edits in place** (below) with the owner's archive behind an inline confirmation, then **People** and the invitation page, which the server renders. Empty, loading, no-match and error states are drawn; under 760 px the rail becomes a sheet and the tables become lists.
- **Editing in place**: **Edit** in the row's drawer gives a control to every field the door lets this person update (`can.update` on the table and `access: write` on the field; the owner has all), filled from the row: text, long text, number, money, date, e-mail, link, phone, tick box, several choices, one link and a list of links. **Save** and **Cancel** sit in the drawer's footer, the door's validation words appear under the field they are about, and only what was changed is sent (a field that was emptied goes as `null`). A single choice keeps the select it already had in the detail, which saves as soon as it changes, and is not repeated; a field the person may only read stays text, a hidden one is not on the page; files and people are not edited here. The edit is sent with the revision it started from (`rev`): if the row has moved on, nothing is written and the drawer says someone else changed it, keeps what was typed and offers **Reload this row**. The door has no such precondition, so `POST /api/apps/:slug/write` checks it (`409 conflict`, with the current `rev`) in the same tick as the write, which in one process nothing can interleave with; an update that names no `rev` is last-writer-wins, as before.
- **Rights**: the page draws only what the door says the person may do (`can` on a table, `access` on a field), and a refused write is shown with the door's message and rolled back. Nothing is hidden by the page that the door would allow, nothing is shown that it would refuse; the server still decides every call.
- **Code**: ES modules, no framework, no bundler. `js/model.mjs` is pure (rights, titles, sorting, board, forms, relations layout) and runs in Node; `js/dom.mjs` builds nodes from text (there is no `innerHTML`); `js/api.mjs` is the page's calls (CSRF token fetched and retried once); `values.mjs`, `forms.mjs`, `views.mjs` draw; `main.mjs` holds the state and the routes (`#/<app>/<table>/<view>`).
- **Served** from the allow-list in `lib/assets.mjs`: each file with its own content type, `no-cache` and an ETag (`304` when the browser holds it). Anything else is `404` (no folder listing, no source, no `..`). Adding a file to `public/` means adding it to the list: a check fails if the two differ.
- **Policy**: the Content-Security-Policy is unchanged (`script-src 'self'`, `style-src 'self'`). So there is no inline script, no `<style>`, no `style=""`, no `on…=` handler and no external font or CDN in any page, and a check fails if one appears. Pictures are inline `<svg><use href="#…">` from a sprite in `index.html`.

## Routes

`/` and the files of `public/` (the list in `lib/assets.mjs`) · `/health` · `/api/csrf` · `/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session` (Better-Auth; everything else under `/api/auth/` is `404`) · `/open` · `/api/me` · `/api/me/password` · `/api/apps` · `/api/apps/:slug/records|links|write|upload|file` · `/api/apps/:slug/bundle|fingerprint|snapshot|snapshot/manifest|snapshot/db|blobs/:hash|release` (owner only, above) · `/api/people…` · `/people…` · `/invite` · `/api/invitations/accept` · `/privacy` · `/account` · `/account/delete` · `/api/me` (`DELETE`) · `/api/me/export` · `/api/apps/:slug/export.json` · `/activity` · `/api/audit`.

An app answer is the door's, mapped to http: `forbidden` → 403, unknown app/table/row → 404, `invalid` → 400, `conflict` (an update that names a stale `rev`) → 409. The request never names a database or a profile: the slug picks the app, the session picks the profile.

## Safety

- Every request that changes anything needs a matching **Origin** *and* a **CSRF token** (signed double submit: `GET /api/csrf` sets an HttpOnly cookie and returns the token to send as `x-csrf-token`, or as the `_csrf` form field), unless it is a valid owner API token request with no cookie (above).
- Cookies are `HttpOnly; SameSite=Lax`, and `Secure` on https (Better-Auth's, and the CSRF cookie with a `__Host-` prefix).
- Headers on every answer: a Content-Security-Policy with no inline script and no inline style (`default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, same-origin resource policy; HSTS on https.
- Bodies: 1 MiB, uploads 26 MiB (the door still applies the field's own limit), an app bundle `KB_BUNDLE_MAX_BYTES` (256 MiB by default; the bundle is held in memory, once on the way in and about twice on the way out, so size the machine for it or lower the cap, and pull a big app with the pieces). An oversize body is refused before it is read, so some clients see the connection drop instead of the `413`. A person's file is answered by kybernos-db's `serve-user-file.mjs`: its type comes from its first bytes (never from what was said at upload), a picture is shown in place, anything else is a download, and the answer shuts the document (`default-src 'none'; sandbox`, `nosniff`, `no-store`).
- Rate limits (in memory, per client address) on sign-in (per address+e-mail and per address), `/open`, invitation accept, and invitations sent; per person on erasing an account, exporting and reading the account or the log. A restart resets them.
- The server-rendered pages set `<meta name="referrer" content="same-origin">`: the app's `Referrer-Policy: no-referrer` makes a browser send `Origin: null` with a posted form (measured in Chrome), which the Origin check would refuse. `same-origin` sends the Origin to this server and nothing to any other site.
- One process per team space. Sessions are Better-Auth's; secrets are never logged.

## Vendoring

`lib/db.mjs` is the one import point. A built app carries `vendor/kybernos-db/`: the door (`api.mjs`), `agent/service.mjs`, `template.mjs`, `instantiate.mjs`, `serve-user-file.mjs`, `core/`, `store/` and `remote/` (the token, the bundle codec and the snapshot code), found by following their relative imports (never tests, pages or the plugin entry), with `VENDORED.json` listing each file and its sha256. It is a copy: change `packages/kybernos-db` and build again.

## Tests

- `test-tables-pure.mjs`, `test-tables-team.mjs` (in `packages/kybernos-webapp-creator`): tokens, the owner's link, the bearer rule of the edge, the bundle cap, invitations, the limiter, CSRF/Origin, secrets, roles → actor, the store, people, the vendoring. No dependencies; they run in CI. The token, the bundle codec (with hostile input) and the snapshot code are tested where they live: `packages/kybernos-db/test-remote.mjs`.
- `test-tables-freeze.mjs` (same folder): the freeze's state in its file (kept across a restart, never claimed when it cannot be saved) and which requests count as writes; the routes are in `scripts/check-tables-app.mjs`, group *the hosting server*.
- `test-tables-mail.mjs` (same folder): the Resend adapter against a fake provider on a local port: the request (URL, bearer, JSON body), the text and the html (nothing remote, everything escaped), a refusal, a timeout, a dropped connection and a redirect, none of which shows the provider's words or the key; the settings from the environment; the people calls with a mailer that sends, fails or throws. No dependencies; runs in CI.
- `test-tables-privacy.mjs` (same folder): the activity log (redaction with secrets planted in every argument, append-only, retention with a clock, the cap, paging, filters, the sentences), a person's export, the erasure of a person on a stand-in with Better-Auth's own columns (searched in every table and in the bytes of the file and its log, with a control showing that plain `DELETE`s leave the bytes), the owner's export of an app, and the privacy, activity and account pages. No dependencies; runs in CI.
- `test-tables-front.mjs` (same folder): the client's pure part (`public/js/model.mjs`): rights, what is editable in place and what an edit sends, titles, sorting, board, form checks and wording, the relations layout, routes. No dependencies; runs in CI.
- `scripts/check-tables-app.mjs` (repo root): installs the three dependencies in a temporary folder (or reuses `TABLES_APP_NODE_MODULES`), boots the built app on a free port and runs the whole thing over http (a few seconds): the 16 checks of the spike, the files of the page and the policy (content types, headers, `304`, what is not served, traversal, no inline script or style on any page, no `innerHTML` in the client), the e-commerce rights matrix for the owner and two members, the owner's link, invitations, removal, CSRF/Origin, cookie flags, an update that names its revision (applied, a stale one refused as a conflict, a malformed one refused, rights unchanged), the owner's API token (accepted, refused in nine ways, cookie and bearer together, members and anonymous on every transfer route) and the transfer routes (an app out as one bundle and in pieces, a bundle in, a round trip equal to the original, conflicts, hostile bundles, the size cap, release), and the rate limits; then the L7 part: invitation e-mails through a second instance started with a provider key and a fake provider (the mail, a refusal, a resend, the link in the mail working), a person's export, the delete of one's own account by form and by JSON (and every refusal), the owner's removal of a person with a search of the whole of `auth.sqlite` and its log, the owner's export of an app (and who may not), and the activity log (every kind present, nothing secret or personal in the answer, the page or the table, append-only in the file itself). The output of both instances is searched for the key and the planted names.
- `scripts/check-tables-front-live.mjs` (repo root): the same built app in a real headless Chrome (found on the machine, or `CHROME=<binary>`; exits 0 saying `skipped` when there is none): sign-in, search, sort, a row, board drag and drop and a refused move, relations, add a row, archive, a row edited in place (text and links, a refused value, a conflict), the owner's and two members' views (one who may only read, one who edits part of a row, with no hidden field on the page or on the wire), the People and invitation pages, the privacy page, the activity page (paging, filter), the « Export data » control, the account page and the delete dialog (a wrong address, then the right one, then the sign-in refused), each measured (nothing sideways, panels inside the window, text of at least 13 px, a thumb-sized button on a phone), a 390 px phone, and no console error or policy violation across the run. `--shots <folder>` saves screenshots there (keep them out of git).
- `test-templates.mjs` boots the stack through the real runtime when `TABLES_APP_NODE_MODULES` points at installed dependencies, and says `SKIPPED` otherwise.

## Out of scope here

Publishing an app into a space (L5b is the DSH side that moves an app in and out and mirrors it), running the space on the Cloud pot (L6), the table/board/relations designer (the client adds rows, edits the fields the door lets a person write and changes a row's status; structure is the owner's in the DSH), who changed what (the door exposes no journal), a reserved-word list for slugs (the host names are L6's), password reset and e-mail verification, OAuth, several owners, backups of the space, changing a name or an address (erase and invite again), and everything the hosting itself keeps (see `docs/dev/tables-l7-hardening.md` for what the server session still owes).
