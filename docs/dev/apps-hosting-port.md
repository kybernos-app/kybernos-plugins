# The hosting port of Publish (apps)

What the `kybernos-db` plugin needs from the thing that runs team spaces, written for whoever builds that side (L6, the server) and for anyone who wants to point Publish at a
space they run themselves. The plugin side is `packages/kybernos-db/remote/` (`hosting.mjs` is the port, `publisher.mjs` the one place that uses it); the hosted side is the
template `packages/kybernos-webapp-creator/templates/tables` (its README is the contract of the http routes). The decisions behind both are in
`docs/etudes/2026-10-31-share-as-app-cadrage.md` (section 12 for the choice of the computer).

## What Publish is, in five lines

- Publish puts an app (a `kybernos-db` database with its attachments) into a **team space** on one of the person's own cloud computers: one small web app per computer, which holds any number of published apps.
- **Publish never creates a computer.** The person chooses among the ones they have (`hosts()`), and a button opens their Kybernos server so they can order another (`orderUrl`).
- From then on the hosted copy is the truth. The folder on the owner's computer is a read-only **mirror**, refreshed from it (a 30 s poll, after each write, on demand).
- Rows are written on the hosted app (as the owner, with an API token); structure, views, profiles, archive and delete are refused with code `published` until the app is unpublished.
- Unpublish pulls the hosted copy one last time, takes it out of the space, and the app is an ordinary local one again. Moving an app to another computer is Unpublish, then Publish.

## The port

The plugin never talks to a billing system, a cloud or an account. It asks an object, given to it by the host process, that has this shape:

```js
hosting = {
  available(): boolean,                       // false: no Publish button, no card, no control that does nothing
  describe(): { name, orderUrl? },
  hosts(): Promise<{ ok: true, hosts: Host[] } | { ok: false, code, message }>,
  ensureSpace({ host }): Promise<{ ok: true, space: { id, url, bootKey } } | { ok: false, code, message }>,
  releaseSpace?(spaceId): Promise<{ ok: boolean }>,   // optional
}
Host = { id, name, state: 'running' | 'sleeping' | 'starting' | 'stopped', region?, alwaysOn?, shared? }
```

It is handed over with `apply(ctx, { remote: { hosting } })` (`packages/kybernos-db/index.js`). A host that does not give one gets `envHosting(process.env)`, which is
`unavailable` unless two environment variables are set (below). **The default is "not available": a product with no hosting shows no Publish button.**

None of the methods may throw. If one does, or answers something that is not in the shape above, the plugin treats it as a failure and says so in plain words; it never stops DSH
from starting and never shows what the port said except the `message` of a refusal.

### `available()`

Synchronous and cheap, called on every state read. `false` hides everything. Return `false` while the account is not allowed to publish, while the server cannot be reached, or
while the feature is off; the plugin does not distinguish and shows nothing.

### `describe()`

Plain data, no secret, read when the card is drawn. Unknown keys are dropped, a name is cut at 80 characters.

| key | meaning |
|---|---|
| `name` | What the card calls the product that runs the computers ("Kybernos"). |
| `orderUrl` | The `https://` address the Publish card opens in the person's browser ("Get another cloud computer"): the server's Computers page. **No credentials in it** (`user:password@`), no spaces; the plugin never builds it, completes it or adds anything to it. An address that is not `https`, or has credentials, is treated as no address. **No address, no button**: the page then shows none. |

There is no price, no budget and no region here any more: they belong to a computer (`hosts()`) or to the server's own page, not to the dialog.

### `hosts()`

The person's own cloud computers, **read when the Publish dialog opens and again when the person presses Publish, never on a state read or a header draw**. Plain data, no secret.

| key | meaning |
|---|---|
| `id` | Required. `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`, stable, the same rule as `space.id`. A computer without a usable id, or whose id was already listed, is dropped. |
| `name` | What the person calls it. Shown as is (whitespace folded, cut at 80 characters); the id is shown when it is missing. |
| `state` | `running`, `sleeping`, `starting` or `stopped`: what the computer is now. Anything else is read as `stopped`. A sleeping one is woken by `ensureSpace`; the dialog says so. |
| `region` | Where it runs ("Frankfurt, EU"), shown as is, cut at 80 characters. |
| `alwaysOn` | **`true` only if the computer is really set to never sleep.** The dialog says "always on" if and only if this is `true`. |
| `shared` | `true` when the computer also runs the person's own agents (every computer of ADR 0052 does), which makes the dialog suggest a separate one for an app the team uses daily. |

- An **empty list is a valid answer** (the person has no computer): the dialog then shows only the order button. At most 50 computers are read.
- A refusal is `{ ok: false, code, message }`. A port that throws, answers something else than this shape, or does not answer within 15 s is "the computers could not be listed"
  (`hosts-unreachable`): the dialog keeps its facts and the order button and offers Try again. `hosts()` failing never makes Publish succeed and never changes anything already published.
- The plugin remembers, with each published app, the id of its computer and the **last name and region it saw** for it, so the Apps page can say "on Studio · Frankfurt" without asking.

### `ensureSpace({ host })`

Called by Publish, after the person pressed the confirm button, and never before. `host` is the `id` of a computer **that the plugin has just read in `hosts()`**: an id that was not in
that answer is refused by the plugin itself (`unknown-host`) without asking anything of the port. It returns the space on that computer, starting it if need be (waking the computer if
it sleeps); calling it again for the same host returns the same space (same `id`, same key).

- `space.id`: `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`, stable. It is the key of the plugin's registry. A given `id` belongs to one computer for good: a different computer answering with the same `id` is refused.
- `space.url`: the **origin** of the space, `https://…`, or `http://localhost…` / `http://127.0.0.1…` for a space run on the same machine. No credentials, path or query. Anything else is refused by the plugin.
- `space.bootKey`: the space's boot key, hex, at least 32 characters. See below.
- It may take time (the plugin awaits it with no timeout of its own: it is a button the person has pressed, and the dialog says "This can take a minute"). Resolve it once the space **answers** `GET /health`; the first request after that is the bundle.
- A refusal is `{ ok: false, code, message }`; `message` is shown to the person as it is (plain English, at most 300 characters, no secret) and the dialog stays open with the choice kept. Codes the page knows:
  `unknown-host` (not one of the person's computers), `host-gone` (it was deleted), `host-unavailable` (it cannot be started now), `unavailable` (feature off), `budget` (the pot it is paid from is
  empty, still mapped to a readable failure). Any other code is passed through and treated as a failure to start.
- It must not throw; if it does the plugin answers `hosting-failed` with a generic message.

### `releaseSpace(spaceId)` (optional)

Called when the last app of a space has been unpublished, so a hosting that bills a computer can give it back. The plugin forgets the space only if `{ ok: true }` comes back; on any
other answer it keeps the space (and its key) and tries again at the next last-unpublish. Not implementing it means the space stays until the host removes it.

## The registry, and what "its computer is gone" means

The plugin's registry file records, with each space, the id of its computer, and with each published app the same id plus the name and region last seen for it. It also keeps `lastHost`,
the computer the last Publish went to, only as the default choice of the next dialog (a choice that is no longer listed is not offered). A file written before computers were chosen has none
of these and opens as it is: such an app shows its web address instead of a computer, and can never be "gone".

An app is **gone** (the page says "Its computer is gone", keeps the local copy safe and offers only "Keep my local copy and forget the web app") when **both** hold:

1. the app could not be reached (the pull failed with `unreachable` or `space`: a space that answers, even to refuse, is not gone), and
2. a `hosts()` call that **succeeded** does not list its computer.

A `hosts()` that failed, threw, lied or timed out proves nothing and changes nothing. To keep the server from being hammered by an app that fails every thirty seconds, the plugin asks
`hosts()` for this at most **once a minute** in all, however many apps fail. An app that answers again is not gone, whatever a list said before. Forgetting an app whose computer is gone also drops
its space from the registry when no other app lives there, so no key is kept for a computer that does not exist.

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
(longer, up to five minutes, after failures) plus one per row written. **A sleeping computer**: a pull that does not get an answer is "could not be reached" exactly as if the computer were
off, with the same back-off; the server should count the hosted app's requests as activity so the computer is not put to sleep under the team.

Every answer is judged by status and by a short `error` code in a JSON body; the plugin never shows a body. Statuses it distinguishes: `401` (key refused), `413`, `429`, `5xx`
(the space has a problem), `3xx` (never followed), a network error or a timeout (20 s for a small call, 120 s for a database or a file) is "could not be reached".

## What the plugin guarantees to the space

- Nothing is registered as published before the hosted copy has been uploaded and its fingerprint compared with the one that was sent. A failure after the upload releases it
  (`POST release`); if even that fails the upload is remembered (a "pending" note in the registry) and taken out first at the next attempt.
- An app with a `sensitive` or `secret` field is never sent. `personal` fields may go; the card lists them.
- One publish or unpublish per app at a time. Nothing is deleted on the owner's computer by Publish; Unpublish deletes the hosted copy only after checking it is the state the owner's
  computer now holds.
- Nothing is asked of a computer the person does not have: `ensureSpace` is only called with an id from a `hosts()` answer read for that Publish.

## The development / self-hosting adapter

`remote/hosting.mjs` has `envHosting(env)`: with `KYBERNOS_DB_SPACE_URL` (the space's origin) and `KYBERNOS_DB_SPACE_KEY` (its boot key) set **in the environment of the DSH
process**, Publish is available and points at that one space: `hosts()` answers a single running computer called "Your own team space" (no region, no "always on", not shared), and
`ensureSpace({ host })` hands the space back for that computer's id and refuses any other (`unknown-host`). `KYBERNOS_DB_ORDER_URL` may add an `https` order address (checked like any
`orderUrl`), so the order button can be seen against `localhost`. It is read once at start by the host process; no request, no page and no agent can set it, and it is not the default. It is
how `scripts/check-publish.mjs` and the GUI checks run Publish against a space on `localhost`.

## The real adapter: the person's cloud computers through their Kybernos account

`remote/cloud-hosting.mjs` (`cloudHosting()`) is what a signed-in DSH uses when the host process gave no hosting and no environment points at a space (`chooseHosting` in `index.js`: given, then
`envHosting`, then this). It asks the server of the active workspace (kybernos-server, `team-space` routes, ADR 0061 section 12) and holds no secret: it reaches the server only through
`globalThis[Symbol.for('kybernos.cloud')]`, which kybernos-cloud publishes (`call`, `workspace`). That seam adds the account token itself, and for this adapter it allows exactly three calls, only
for the workspace the person has **active** now (any other workspace id is `workspace_refused`):

| port | call | notes |
|---|---|---|
| `hosts()` | `GET /v1/workspaces/<ws>/team-space/hosts` | `region_label` (else `region`) is the region; `alwaysOn` and `shared` are `true` only when the server said `true`; `order_url` is kept for `describe()` (an `https` address or none). Owners and admins only: a member gets a refusal. |
| `ensureSpace({ host })` | `POST /v1/workspaces/<ws>/team-space` `{ host }` | `200` and `ready` hands over `{ id, url, bootKey }` (`boot_key`); `202` or a not-ready `200` is asked again after `retry_after_seconds` (kept between 2 s and 30 s, 5 s when it does not say), for five minutes at most, then `host-unavailable`. A `frozen` space is not handed out (`host-unavailable`). |
| `releaseSpace(id)` | `DELETE /v1/workspaces/<ws>/team-space?space=<id>` | `{ ok: true }` only when the server answered `released: true`. A `404` is **not** read as "already gone" (another workspace answers it too, and a space forgotten here is a lost key). |

- **`available()` is synchronous, so it answers what the server last said.** True only after a read of the computers worked for the active workspace; a first look after a start is "no" and starts that read in the
  background (one at a time). A server without the routes (`404`), with hosting switched off (`503 teamspace_disabled`) or a member who may not publish (`403`) is "no" for five minutes; an answer that proves
  nothing (network, busy, signed-out account) keeps what was known and asks again after a minute. The verdict belongs to one workspace. Signed out, with no cloud bundle, or with a seam from before
  `workspace()`: never available, and nothing is asked.
- **Server refusals become the codes the page knows, with our own message** (the server's words are never passed on): `unknown_host` and `host_required` to `unknown-host`, `host_gone` to `host-gone`,
  `host_unavailable` to `host-unavailable`, `budget_exhausted` to `budget`, `teamspace_disabled` and a server without the routes to `unavailable`, a `403` to `forbidden`; the rest, and every network failure, to `hosting-failed`.
- **Known limit: one workspace at a time.** The registry does not record which workspace a space was made in. A person with several workspaces who switches the active one sees that workspace's computers; an
  app published on a computer of the other workspace that cannot be reached at that moment is then judged "its computer is gone" (see above), and `releaseSpace` for it is refused. Nothing is deleted by that
  (the page only offers to keep the local copy), but switching back brings the computer back. Recording the workspace in the registry is the cure, and is not done.
- Tests: `packages/kybernos-db/test-cloud-hosting.mjs` (a fake seam for the server), `packages/kybernos-cloud/test-cloud-seam.mjs` (the seam against a fake API).

## What is not here yet (open for the owner)

- A way to freeze writes on the space for the instant between Unpublish's last check and `release`. Today a write that lands in that window is lost to the owner's computer (the
  window is the length of one request); a `POST …/freeze` on the space would close it.
- Journal attribution of an agent's writes: the space's door journals owner bearer writes as `person`. If the journal should say `agent`, the door needs a header or a field for it.
- The permission string. The plugin's `plugin.json` declares `net:*.kaby.app` and `net:localhost` for the one outgoing `fetch`; the vocabulary of `scripts/plugin-scan.mjs` has no way to say
  "the host the hosting gave", so the domain is a placeholder to correct when the real one is chosen.
- Moving an app from one computer to another in one step. Today it is Unpublish, then Publish (the data comes back to this computer in between, so nothing can be lost).
