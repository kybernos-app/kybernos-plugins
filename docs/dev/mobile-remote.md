# The phone link (`kybernos-mobile`)

A QR code on the computer links a phone to it. The phone then runs the computer's own DSH page, end to end encrypted
through a Kybernos relay. This page is the contract between the plugin (this repository) and the server that runs the
relay, plus the security model. The plugin is built and tested against a stand-in
(`packages/kybernos-mobile/remote-fake-relay.mjs`); **the server half is built and tested in `kybernos-server`
(`docs/adr/0047-phone-link.md`, `docs/runbooks/remote.md`) and not deployed**: this page and that ADR describe the same
routes and the same relay, and the stand-in is kept in step with the server.

## What is built here, and what is not

| Built (this repository) | Built in the server, not deployed | Not built |
|---|---|---|
| the computer's half: pairing, paired phones, the relay connection, the replay against DSH | the `/v1/remote/*` routes, the relay, serving `phone/*` from the phone origin, the plan feature `remote`, the owner's number of phones | the phone origin's host name and certificate (the owner's, infrastructure) |
| the end-to-end channel and its tests | pinned copies of the phone page's files | push notifications, more than one relay replica, a native app |
| the phone page and its service worker | | |
| the sidebar panel and Settings › Remote Control | | |
| a stand-in relay and server for tests | | |

## Why it is paid

The value passes through our server: an always-on relay that holds a connection for every computer, carries the
traffic, and has to be kept available and abuse-proof. Nothing local is taken away: DSH on the computer, and the phone
layout, stay free. The gate is on the server (a plan that does not list `remote` gets `403 remote_not_in_plan`); the
plugin carries no licence check, so nothing in the open code can be removed to get the service.

## The server's contract

Authenticated with the account's bearer token. The plugin reaches these routes only through
`globalThis[Symbol.for('kybernos.cloud')].call(path, { method, body })` (kybernos-cloud adds the token, and refuses any
path outside `/v1/remote/`).

| Route | Answer |
|---|---|
| `GET /v1/remote/devices` | `200 { configured: boolean, entitled: boolean, max_devices: number, devices: [{ device_id, label, computer_label, created_at, last_seen_at }] }` for any signed-in account (this is how the page knows, before a QR code is asked for, whether to show « included in paid plans » or « this server does not offer it ») |
| `POST /v1/remote/pairings` `{ label }` | `201 { pairing_id, sid, phone_url, relay_ws, host_ticket, expires_at, max_devices }`; `403 { error: 'remote_not_in_plan' }`; `429 { error: 'remote_device_limit' }`; `503 { error: 'remote_disabled' }`. It withdraws the person's earlier unfinished pairing |
| `POST /v1/remote/pairings/{pairing_id}/confirm` `{ label }` | `200 { device_id }` (the pairing's id); makes the pairing a durable device; idempotent; `409 pairing_expired`; `403`/`429` again if the plan lapsed or the limit was reached meanwhile |
| `DELETE /v1/remote/pairings/{pairing_id}` | `200 { ok: true }`; the sid stops being accepted; idempotent |
| `POST /v1/remote/devices/{device_id}/ticket` `{ sid }` | `200 { relay_ws, host_ticket, expires_at }`; `403 remote_not_in_plan`; `404` when the server forgot the device **or the `sid` is not the channel's** (the server keeps only a digest of the address, so this is also what proves the caller made the channel) |
| `DELETE /v1/remote/devices/{device_id}` | `200 { ok: true }`; closes the channel with `{ t: 'error', code: 'revoked' }` to both peers; `404` when it is not the person's |

- `sid`: 128 random bits, 26 characters of lower-case base32 (a valid DNS label). It is the address of a channel, not a
  secret that protects content; the server stores only its SHA-256.
- `host_ticket`: single purpose (this channel, the host role), good for an hour, replaced at every `ticket` call. The
  account token never goes to the relay.
- `phone_url`: where the phone page is served (`…/__kb/`), on an origin of its own. The QR code is
  `phone_url + '#' + sid + '.' + code + '.' + hostIdentityKey`. Everything after the `#` stays in the phone's browser:
  the server never receives the one-time `code`.
- Pairing lifetime: 5 minutes, single use. A pairing that was not confirmed is deleted by the server's sweep.
- How many phones: the owner's setting `remote_max_devices_per_user` (default 3), read when a pairing starts and when it
  is confirmed. `max_devices` is 0 for a plan that does not list the feature.

### The relay: `GET {relay_ws}` (WebSocket)

Text frames are **control frames from the relay**; binary frames are **opaque frames between the two peers**. A peer's
text frame is never forwarded, so a peer cannot forge a control frame.

| Direction | Frame |
|---|---|
| peer → relay (first frame, text) | `{ t: 'auth', role: 'host', sid, ticket }` or `{ t: 'auth', role: 'phone', sid }` |
| relay → peer | `{ t: 'auth-ok' }`, then `{ t: 'peer', state: 'up' \| 'down' }` whenever the other side connects or leaves (`down` is also what a peer alone on the channel is told) |
| relay → peer, then close | `{ t: 'error', code }` with `code` in `bad_auth`, `unknown_sid`, `bad_ticket`, `not_in_plan`, `revoked` |
| peer → relay → other peer (binary) | forwarded unchanged; the relay keeps a byte count and nothing else |

A new connection for the same `sid` and role replaces the previous one. A phone is accepted only on a sid that is an
unexpired pairing or an active device; a host only with the current ticket and an entitled plan.

### Entitlement

`remote` is in `FEATURE_KEYS` of the server's `src/modules/billing/features.ts` and in **no** default list: a plan
version that lists it has the phone link, one that does not has not (data, not code). It is read for the person's
personal workspace. The number of phones is the owner's setting `remote_max_devices_per_user`. Existing devices of an
account that loses the feature are kept (listed, locked) and reconnect when it comes back.

## The end-to-end protocol (`packages/kybernos-mobile/remote-e2e.mjs`)

WebCrypto only; the computer (Node) and the phone page run the same file.

- Long-term keys: an ECDSA P-256 identity on each side. The computer's public half is in the QR code.
- Every connection: fresh ECDH P-256 pairs; HKDF-SHA256 over the shared secret, salted with the hash of the whole
  transcript, one AES-256-GCM key per direction. The frame counter is the nonce and must be exactly the next one.
- Pairing: `pair` carries the phone's identity and ephemeral key, authenticated with `HMAC(code, …)` (a relay cannot
  forge it: it never sees `code`); `pair-ok` carries the computer's ephemeral key signed with its identity (a relay
  cannot forge that either: the phone holds the identity key from the QR code). Both sides derive the same 4 digits,
  which the person compares and approves on the computer.
- Reconnection of a known phone: `resume` signed with the phone's identity, `resume-ok` signed with the computer's.
- Frames after the handshake: a JSON header plus an optional binary body (`req`, `res`, `chunk`, `end`, `cancel`,
  `ws-open`, `ws-msg`, `ws-close`, `hello`, `approved`, `denied`, `ready`, `bye`).

`test-remote-e2e.mjs` runs the attacks: wrong code, a relay swapping the phone's key, a computer that is not the one in
the QR code, a replayed, reordered, truncated or tampered frame, an unknown or revoked phone, a replay across sids.

## What a phone may ask the computer for

The computer replays a phone's HTTP requests and its `/api` WebSocket against its own DSH, with DSH's own session
cookie, `Origin` and `Host` of the computer's page, and the marker header `x-kybernos-tunnel: 1`. The plugin's own
routes refuse any request that carries the marker, so **a phone can never add, approve or remove a phone**.

Refused for a phone (`refusedOnPhone` in `remote-host.mjs`, answered `403 refused_on_phone`): credential writes, DSH
settings writes, plugin install/remove/enable, the dynamic runner's invoke, terminal create/write, DeepSeek account
sign-in/out, creating or changing a schedule, `/kybernos-cloud/disconnect`, `/kybernos-cloud/server/apply`,
`/kybernos-cloud/start`, and every `/kybernos-mobile/remote/` route. The list is data in that file; the live check
counts refusals during normal use (`refused` in the status).

Responses are gzip-compressed when textual; the phone's service worker decompresses and caches hashed files
(`/assets/<name>-<hash>.<ext>`, `…&rev=<hex>`), so only the first load is heavy (measured: 26 MB decompressed for the DSH
page, a few MB compressed).

## Origins (the one decision the server owns)

The service worker takes the whole origin (scope `/`): DSH's page must be served at `/`, and DSH's absolute URLs
(`/api`, `/assets`) must reach it. That means **one origin per paired phone and computer**. Options:

- a wildcard name (`<sid>.m.kybernos.app`) with a wildcard certificate: each pairing is its own origin, own service
  worker, own storage, own home-screen icon; or
- one origin and a single computer per phone browser profile (the phone page keeps one pairing): simpler, but pairing a
  second computer replaces the first.

The phone page does not care which: it reads the sid from the QR fragment and from its own storage. The server
refuses to start with the API's own host as the phone origin (`REMOTE_PHONE_URL`), because the service worker takes
over every request of the origin it is served from.

**Decision (owner, 2026-10-12): launch with ONE origin** (for example `https://phone.kybernos.app`; the name is the owner's).
One certificate, one DNS record, nothing to provision per pairing. The price is the second bullet above: a phone keeps one
computer, and pairing another replaces the first. The wildcard (`<sid>.m.…`) stays possible later with no change to the
page. What the owner sets for the launch: the DNS name pointing at the server, `REMOTE_PHONE_URL=https://<that name>`, and one
replica (the relay's rooms live in memory). The end user installs nothing and sees an ordinary https link in the QR code.

The phone page files the web origin must serve (all from `packages/kybernos-mobile/`, byte for byte):

| URL | File |
|---|---|
| `/__kb/` | `phone/index.html` |
| `/__kb/phone.mjs` | `phone/phone.mjs` |
| `/__kb/remote-e2e.mjs` | `remote-e2e.mjs` |
| `/__kb/manifest.webmanifest`, `/__kb/icon.svg` | `phone/manifest.webmanifest`, `phone/icon.svg` |
| `/sw.js` (with `Service-Worker-Allowed: /`) | `phone/sw.js` |

Serve them with `Cache-Control: no-store` (or content-hashed names) so a fix reaches phones at once, and keep the page
free of third-party scripts: it is the one piece of code the end-to-end promise depends on. A strict policy on the
phone page itself fits it (`default-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'; frame-src 'self';
base-uri 'none'; form-action 'none'`); it must not be applied to the DSH page the service worker serves in the iframe, which
keeps whatever headers DSH sends (the computer's own `Content-Security-Policy` and `X-Frame-Options` are dropped on the way).

## Honest limits

- The encryption protects the traffic from the relay, its logs and the network. It does not protect from a web host
  that serves a hostile phone page (the same limit as any web app that does cryptography in the page). Serving the
  files from a version-pinned, public path and publishing their hashes narrows it; a native app would remove it.
- Whoever holds the unlocked phone has the power of the keyboard, under DSH's own approvals. Revocation is immediate
  (here and at the server), and a device that lost its plan locks.
- The computer must be on. There is no queue.
- Push notifications (« your agent needs an approval ») are not built: with end-to-end encryption the server can only
  send a generic wake-up.

## Tests

```sh
cd packages/kybernos-mobile && for t in test*.mjs; do node "$t" || exit 1; done
node packages/kybernos-cloud/test-cloud-seam.mjs
# on the real GUI, an isolated DSH (never the real one):
source scripts/sandbox/env.sh && scripts/sandbox/start.sh
node scripts/check-mobile-remote-live.mjs --shots <dir>
```

### Against the real server, and with a real phone

The same live check runs against the REAL server instead of the stand-in relay (`--real`): `kybernos-server`'s
`scripts/replica.ts` (the application on an embedded Postgres, stand-ins for payments and models, a made-up owner) behind
a public https tunnel (`ngrok`, the person's own account). The phone page is then served from a real https origin, the plan
that lists `remote` is published through the server's own admin API, and the DSH is connected by the device approval a
person goes through. It adds the checks of what a stranger finds at the public address (the phone page and nothing else).

```sh
source scripts/sandbox/env.sh && scripts/sandbox/start.sh
export KYBERNOS_SERVER_DIR=<kybernos-server checkout, branch with the phone link>
node scripts/check-mobile-remote-live.mjs --real --shots <dir>   # a headless Chrome plays the phone, through the tunnel
node scripts/mobile-remote-up.mjs                                # the same set-up for a REAL phone: the QR code is drawn in the terminal
```

`mobile-remote-up.mjs` waits for the phone's 4-digit check, shows it, and asks `y/N` before it approves (the gesture the
Settings page offers). Ctrl-C closes the tunnel and the server and puts the isolated DSH's files back. One thing a person
sees only here: ngrok's free plan shows a one-time warning page on the first visit; tap « Visit Site ». It is the tunnel's,
not the phone link's. Only one ngrok session can be online at a time on a free account.

What this still does not prove: Safari on an iPhone and Chrome on an Android phone (the service worker and the WebSocket
shim are the same code, but the engines are not), a phone that sleeps and wakes on another network, and a real deployment's
origin (`REMOTE_PHONE_URL` on the platform, one replica).


## Frames leave in counter order (2026-10-13)

The channel requires every frame's counter to be exactly the next one (a relay can neither replay, drop nor reorder). The
computer therefore sends the frames of a link **one at a time, in the order they were asked**, and waits for a backed-up
socket (`highWater`, 512 KB) *inside* that queue and *before* sealing. A wait after the seal let a frame sealed first leave
last whenever the computer's uplink was slower than the answers (a real home line, never a loopback): the phone then
rejected that frame and every later one ("e2e: frame out of order"), and nothing loaded again until the phone reconnected.
The phone page leaves the connection after three such frames in a row, which starts a new channel (counters at zero).
`test-remote-host.mjs` backs the socket up (a `bufferedAmount` the test controls) and sends a late burst of small requests.
