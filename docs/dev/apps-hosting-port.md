# The hosting port of Publish (apps)

What the `kybernos-db` plugin needs from the thing that runs team spaces, written for whoever builds that side (L6, the server) and for anyone who wants to point Publish at a
space they run themselves. The plugin side is `packages/kybernos-db/remote/` (`hosting.mjs` is the port, `publisher.mjs` the one place that uses it); the hosted side is the
template `packages/kybernos-webapp-creator/templates/tables` (its README is the contract of the http routes). The decisions behind both are in
`docs/etudes/2026-10-31-share-as-app-cadrage.md`.

## What Publish is, in four lines

- Publish puts an app (a `kybernos-db` database with its attachments) into a **team space**: one small web app per workspace, which holds any number of published apps.
- From then on the hosted copy is the truth. The folder on the owner's computer is a read-only **mirror**, refreshed from it (a 30 s poll, after each write, on demand).
- Rows are written on the hosted app (as the owner, with an API token); structure, views, profiles, archive and delete are refused with code `published` until the app is unpublished.
- Unpublish pulls the hosted copy one last time, takes it out of the space, and the app is an ordinary local one again.

## The port

The plugin never talks to a billing system, a cloud or an account. It asks an object, given to it by the host process, that has this shape:

```js
hosting = {
  available(): boolean,                       // false: no Publish button, no card, no control that does nothing
  describe(): { name, pricePerMonth?, currency?, alwaysOn?, region?, budget? },
  ensureSpace({ workspace }): Promise<{ ok: true, space: { id, url, bootKey } } | { ok: false, code, message }>,
  releaseSpace?(spaceId): Promise<{ ok: boolean }>,   // optional
}
```

It is handed over with `apply(ctx, { remote: { hosting } })` (`packages/kybernos-db/index.js`). A host that does not give one gets `envHosting(process.env)`, which is
`unavailable` unless two environment variables are set (below). **The default is "not available": a product with no hosting shows no Publish button.**

### `available()`

Synchronous and cheap, called on every state read. `false` hides everything. Return `false` while the account is not allowed to publish, while the server cannot be reached, or
while the feature is off; the plugin does not distinguish and shows nothing.

### `describe()`

Plain data, no secret, read when the card is drawn. Unknown keys are dropped, values of the wrong type become "unknown" (never a claim), strings are cut at 80 characters.

| key | meaning |
|---|---|
| `name` | What the card calls the thing it publishes into ("Kybernos team space"). |
| `pricePerMonth`, `currency` | A number and an ISO 4217 code. Shown as an estimate of the monthly cost, and only when both are given. |
| `alwaysOn` | **`true` only if the space really stays up when the owner's computer is off.** The page says "always on" if and only if this is `true`; anything else says nothing about it. A space that sleeps, or that is a development process, must not claim it. |
| `region` | Where it runs, shown as is. |
| `budget` | `{ label, remaining, enough }`: the pot the space would be paid from. `enough: false` makes the card refuse Publish with its reason (`budget`); `remaining` is shown when it is a number. |

### `ensureSpace({ workspace })`

Called by Publish, after the owner pressed the confirm button, and never before. It returns the space this workspace publishes into, creating it if there is none; calling it again for
the same workspace returns the same space (same `id`). The plugin currently passes `workspace: 'default'` (one workspace per computer); the host maps that to whatever it uses.

- `space.id`: `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`, stable. It is the key of the plugin's registry.
- `space.url`: the **origin** of the space, `https://…`, or `http://localhost…` / `http://127.0.0.1…` for a space run on the same machine. No credentials, path or query. Anything else is refused by the plugin.
- `space.bootKey`: the space's boot key, hex, at least 32 characters. See below.
- It may take time (the plugin awaits it with no timeout of its own: it is a button the person has pressed). Resolve it once the space **answers** `GET /health`; the first request after that is the bundle.
- A refusal is `{ ok: false, code, message }`; `message` is shown to the person as it is (plain English, at most 300 characters, no secret). Use `budget` for a pot that is empty, `unavailable` for a feature that is off; any other code is passed through and treated as a failure to start.
- It must not throw; if it does the plugin answers `hosting-failed` with a generic message.

### `releaseSpace(spaceId)` (optional)

Called when the last app of a space has been unpublished, so a hosting that bills a computer can give it back. The plugin forgets the space only if `{ ok: true }` comes back; on any
other answer it keeps the space (and its key) and tries again at the next last-unpublish. Not implementing it means the space stays until the host removes it.

## The boot key

The boot key is the one secret of a space. The space verifies two kinds of signed tokens with it, and the plugin makes both from the same key (`remote/token.mjs`, the same file the space
vendors):

- the **owner API token** (`Authorization: Bearer …`, kind `owner-api`): minted per request, valid for five minutes at most. It acts as the space's owner on `/api/apps…` and nowhere else.
- the **owner's one-time link** (`<url>/open?t=…`, kind `open`, ten minutes, once): what "Open web app" sends the person's browser to.

Rules the plugin keeps, and the host should keep too: the key is stored only in the plugin's registry file (`<DSH home>/kybernos/kybernos-db/published.json`, mode 0600, written
atomically); it is never in a state, a log line, an error message, a prompt or a request URL; a response body is never repeated in an error. If the host rotates a key it must hand
the new one to `ensureSpace`: the plugin replaces the space's entry by `id` the next time it is called (until then every call is answered `refused`, and the card says so).

## What the plugin asks of the space

Exactly the routes in the template's README ("the owner's API token and the transfer routes"). The calls, with what the plugin does with each answer:

| call | used for | notes |
|---|---|---|
| `PUT /api/apps/:slug/bundle` | Publish | `409 exists` is retried under the next free name; `409 db-exists` is reported ("a copy of this app is already in the web app"); `413` becomes "too large". |
| `GET /api/apps/:slug/fingerprint` | the poll, the check after Publish and Unpublish | cheap; `404 unknown` means the app is not in the space. |
| `GET …/snapshot/manifest`, `GET …/snapshot/db`, `GET …/blobs/:hash` | the mirror refresh | the manifest and the database must describe the same snapshot (`x-kb-fingerprint`), else the pull starts again, three times at most; every hash and size is recomputed here. |
| `POST …/write`, `POST …/upload` | a row written from the owner's computer | journalled by the space as `person` (the door cannot say `agent`). |
| `POST /api/apps/:slug/release` `{ confirm: slug }` | Unpublish, and the undo of a Publish that failed after the upload | `404 unknown` is accepted as "already gone". |

Rates: the space limits bearer requests to 600 a minute per client address and 30 refused tokens in 15 minutes. The plugin makes one small request per published app every 30 seconds
(longer, up to five minutes, after failures) plus one per row written.

Every answer is judged by status and by a short `error` code in a JSON body; the plugin never shows a body. Statuses it distinguishes: `401` (key refused), `413`, `429`, `5xx`
(the space has a problem), `3xx` (never followed), a network error or a timeout (20 s for a small call, 120 s for a database or a file) is "could not be reached".

## What the plugin guarantees to the space

- Nothing is registered as published before the hosted copy has been uploaded and its fingerprint compared with the one that was sent. A failure after the upload releases it
  (`POST release`); if even that fails the upload is remembered (a "pending" note in the registry) and taken out first at the next attempt.
- An app with a `sensitive` or `secret` field is never sent. `personal` fields may go; the card lists them.
- One publish or unpublish per app at a time. Nothing is deleted on the owner's computer by Publish; Unpublish deletes the hosted copy only after checking it is the state the owner's
  computer now holds.

## The development / self-hosting adapter

`remote/hosting.mjs` has `envHosting(env)`: with `KYBERNOS_DB_SPACE_URL` (the space's origin) and `KYBERNOS_DB_SPACE_KEY` (its boot key) set **in the environment of the DSH
process**, Publish is available and points at that one space (`describe()` is `{ name: 'Your own team space' }`, so no "always on"). It is read once at start by the host process; no
request, no page and no agent can set it, and it is not the default. It is how `scripts/check-publish.mjs` and the GUI checks run Publish against a space on `localhost`.

## What is not here yet (open for L6 and for the owner)

- A real `hosting` that provisions a computer per workspace, bills the Cloud pot and says `alwaysOn: true`. Until it exists nothing in the product offers Publish.
- A way to freeze writes on the space for the instant between Unpublish's last check and `release`. Today a write that lands in that window is lost to the owner's computer (the
  window is the length of one request); a `POST …/freeze` on the space would close it.
- Journal attribution of an agent's writes: the space's door journals owner bearer writes as `person`. If the journal should say `agent`, the door needs a header or a field for it.
- The permission string. The plugin's `plugin.json` declares `net:*.kaby.app` and `net:localhost` for the one outgoing `fetch`; the vocabulary of `scripts/plugin-scan.mjs` has no way to say
  "the host the hosting gave", so the domain is a placeholder to correct when the real one is chosen.
