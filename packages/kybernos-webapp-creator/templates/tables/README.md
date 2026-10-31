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
| `lib/db.mjs` | **The only place that imports kybernos-db.** Looks in `vendor/kybernos-db/` first, then in `packages/kybernos-db/` of this repository. |
| `lib/bootstrap.mjs`, `lib/token.mjs` | The owner's one-time link and the signed tokens. |
| `lib/invitation.mjs`, `lib/people.mjs`, `lib/store.mjs` | Invitations, the owner's people calls, what is kept in `auth.sqlite` beside Better-Auth's tables. |
| `lib/safety.mjs`, `lib/ratelimit.mjs` | Origin, CSRF, headers, client address; the rate limiter. |
| `lib/html.mjs` | The few server-rendered pages (`/people`, `/invite`): plain HTML, no script, no style. L4 restyles. |
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

A hosted run passes both secrets; nothing is written. A local run (the apps runtime passes no environment) gets them generated once into `data/secrets.json`.

## The owner

There is no public sign-up. The person who starts the app mints a link with `KB_BOOT_KEY` (`scripts/mint-link.mjs`): it lives 10 minutes and works once. `GET /open?t=…` creates the owner on first use, sets the cookie and redirects to `/` (the token leaves the address bar at once; `Referrer-Policy: no-referrer`). The link gives a password nobody knows, so the owner sets their own **once** with `POST /api/me/password {"password": "…"}`.

**Break-glass: no master password.** Lost the password? Mint another link: opening it signs the owner in again, ends every other session and allows one new password. Suspect the key? Change `KB_BOOT_KEY` and `KB_AUTH_SECRET` and restart: every session, link and invitation dies.

Link scanners that fetch URLs (mail gateways, chat previews) would spend a one-time link: hand the owner's link over directly, not through a channel that unfurls it.

## People

Owner only, as JSON (`/api/people…`) and as a plain page (`/people`):

- list members and pending invitations; the profile ids come from the profiles the apps define (`owner` is never one);
- **invite by e-mail** (the injected mailer sends the link; the default mailer sends nothing and the link is shown to the owner) or **by link** (no address; whoever holds it joins);
- an invitation is a signed token naming a stored invitation (7 days, one use). What it gives is read from the stored row, so changing a pending invitation's profile changes what the link gives; **resend** makes a new link and kills the old one;
- change a member's profile; **remove** a member: their sessions end at once (their next request is `401`) and the account is deleted.

The invitee opens `/invite?t=…`, picks a name and a password (`POST /invite`, or `POST /api/invitations/accept`), and is signed in with the invited profile.

## Routes

`/health` · `/api/csrf` · `/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session` (Better-Auth; everything else under `/api/auth/` is `404`) · `/open` · `/api/me` · `/api/me/password` · `/api/apps` · `/api/apps/:slug/records|links|write|upload|file` · `/api/people…` · `/people…` · `/invite` · `/api/invitations/accept`.

An app answer is the door's, mapped to http: `forbidden` → 403, unknown app/table/row → 404, `invalid` → 400. The request never names a database or a profile: the slug picks the app, the session picks the profile.

## Safety

- Every request that changes anything needs a matching **Origin** *and* a **CSRF token** (signed double submit: `GET /api/csrf` sets an HttpOnly cookie and returns the token to send as `x-csrf-token`, or as the `_csrf` form field).
- Cookies are `HttpOnly; SameSite=Lax`, and `Secure` on https (Better-Auth's, and the CSRF cookie with a `__Host-` prefix).
- Headers on every answer: a Content-Security-Policy with no script and no inline style (`default-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, same-origin resource policy; HSTS on https.
- Bodies: 1 MiB, uploads 26 MiB (the door still applies the field's own limit). An oversize body is refused before it is read, so some clients see the connection drop instead of the `413`. A person's file is answered by kybernos-db's `serve-user-file.mjs`: its type comes from its first bytes (never from what was said at upload), a picture is shown in place, anything else is a download, and the answer shuts the document (`default-src 'none'; sandbox`, `nosniff`, `no-store`).
- Rate limits (in memory, per client address) on sign-in (per address+e-mail and per address), `/open`, invitation accept, and invitations sent. A restart resets them.
- One process per team space. Sessions are Better-Auth's; secrets are never logged.

## Vendoring

`lib/db.mjs` is the one import point. A built app carries `vendor/kybernos-db/`: the door (`api.mjs`), `agent/service.mjs`, `template.mjs`, `instantiate.mjs`, `serve-user-file.mjs`, `core/`, `store/`, found by following their relative imports (never tests, pages or the plugin entry), with `VENDORED.json` listing each file and its sha256. It is a copy: change `packages/kybernos-db` and build again.

## Tests

- `test-tables-pure.mjs`, `test-tables-team.mjs` (in `packages/kybernos-webapp-creator`): tokens, the owner's link, invitations, the limiter, CSRF/Origin, secrets, roles → actor, the store, people, the vendoring. No dependencies; they run in CI.
- `scripts/check-tables-app.mjs` (repo root): installs the three dependencies in a temporary folder (or reuses `TABLES_APP_NODE_MODULES`), boots the built app on a free port and runs the whole thing over http (a few seconds): the 16 checks of the spike, the e-commerce rights matrix for the owner and two members, the owner's link, invitations, removal, CSRF/Origin, cookie flags and the rate limit.
- `test-templates.mjs` boots the stack through the real runtime when `TABLES_APP_NODE_MODULES` points at installed dependencies, and says `SKIPPED` otherwise.

## Out of scope here

Publishing an app into a space and running the space on the Cloud pot (L5/L6), the restyled client (L4), password reset and e-mail verification, OAuth, several owners, backups of the space.
