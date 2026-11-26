# front-desk — "Accueil client", the public assistant of one shop

A standalone service (not a DSH plugin) that lets strangers talk to **one restricted assistant** of a shop, on a public link. It is
the first lot of "Accueil client": the rules layer, a public runner, an anonymous site chat and a text-only inbox for the owner.

Like every package here it is open source (Apache-2.0). What needs a Kybernos Computer Cloud subscription is running it on the
always-awake cloud computer; this lot checks no subscription itself, that gate belongs to how the cloud computer installs and starts it.

It holds **none of the owner's DSH keys or tools**. It calls a model directly (any OpenAI-compatible endpoint, with its own key),
keeps its own data folder and has its own owner token. DSH never loads it (it is skipped by the bundle fault check, like `messaging`).

## What guarantees what (in code, not in a prompt)

| Rule | Where |
| --- | --- |
| The menu of actions is closed: `leave_message`, `request_callback`, `note_visitor`, `forget_visitor`, `list_slots`, `book_appointment`, `order_status`. A name the model invents is refused. | `core/actions.mjs` |
| Each action is off / approve / auto per shop; parameters are schema-checked (unknown keys refused); the visitor's identity always comes from the channel, never from a parameter. | `core/actions.mjs`, `core/schema.mjs` |
| Creating actions (message, callback, booking) run once per conversation, so a retry never books twice; reads and erasure always run fresh. | `core/actions.mjs` |
| The worst-case cost of a turn is reserved atomically before the first `await`; two turns started together cannot overspend. Daily caps for the shop and per visitor, concurrency, rate per IP / visitor / shop. | `core/budget.mjs` |
| A kill switch (a `KILL` file) is checked first and does not depend on the usage ledger. | `core/budget.mjs` |
| The visitor's text reaches the model fenced as data; the guard-rail block of the fiche never reaches it. Remembered facts are short typed fields, given as data, and grant no right. | `core/fiche.mjs`, `core/runner.mjs` |
| Identity levels: 1 anonymous (a browser, a phone's caller-ID), 2 the channel authenticates the sender (WhatsApp), 3 a one-time code. `order_status` needs 2. | `core/identity.mjs` |
| Remembering a fact needs the visitor's own button; erasure removes the record, the conversations and the messages left. | `core/actions.mjs`, `server/http.mjs` |

Every number a fiche gives is clamped to a hard ceiling in `core/guardrails.mjs`; raising a ceiling is a code change.

## Run it

```bash
# try it with no key and no cost (a scripted model that echoes; say "my name is Ann" to see the consent card)
FRONT_DESK_OWNER_TOKEN=change-me node bin/front-desk.mjs --dry-run --fiche examples/atelier-lune.json --port 8787

# for real
FRONT_DESK_FICHE=shop.json FRONT_DESK_OWNER_TOKEN=... \
MODEL_BASE_URL=https://.../v1 MODEL_API_KEY=... MODEL_NAME=... node bin/front-desk.mjs
```

The chat is at `/` (or `/c/<slug>`), the owner's inbox at `/boite` (it asks for the token). Without `FRONT_DESK_OWNER_TOKEN` there is
no admin at all. The service listens on `127.0.0.1` by default; put your own TLS proxy or tunnel in front, and pass `--trust-proxy`
only behind it. `node bin/front-desk.mjs --scenarios` replays the five scenarios and exits non-zero if one fails.

## The fiche

A free, structured JSON the owner (through Kaby) edits: `name`, `language`, `brand`, `identity`, `tone`, `knowledge` (each fact has a
source and `validated`; only validated facts reach the model), `unknown`, `instructions`, and a `guardrails` block read **only by
code**: `actions`, `budget` (daily and per-visitor caps, prices per million tokens, timezone), `limits`, `allowedOrigins`,
`retentionMonths`. See `examples/atelier-lune.json`.

## HTTP

`POST /c/:slug/messages`, `POST /c/:slug/consent`, `GET|DELETE /c/:slug/me` (header `x-visitor-id`), and for the owner
`GET /v1/admin/overview`, `GET|DELETE /v1/admin/conversations/:id`, `POST /v1/admin/approvals/:id`, `POST /v1/admin/kill`,
`POST /v1/admin/scenarios`. Bodies are JSON, capped at 16 KB; a foreign `Origin` is refused unless listed in `allowedOrigins`; pages
carry a CSP nonce and render data with `textContent` only.

## Tests

```bash
npm test        # node --test test/*.test.mjs
```

They prove: concurrent turns cannot pass the cap, a visitor cannot leave the menu (a hostile scripted model), actions are
idempotent where they create something, an erased visitor is really erased, and the five scenarios pass on their own.

Those tests use a scripted model and a fake model server. To check the one thing they cannot (a real model: it answers from the
facts, invents nothing, leaves a message, asks consent, resists an injection, speaks the visitor's language, cannot pass a tiny cap),
run `MODEL_BASE_URL=… MODEL_API_KEY=… MODEL_NAME=… node bin/live-check.mjs` by hand after a change to the runner, the prompt or the
model. It costs a few cents, is not part of `npm test`, and never prints the key.

## Not in this lot

WhatsApp, Telegram, phone and voice adapters, the embeddable site script, the full CRM view (Gravatar, automations done, skills
learned), Kaby editing the fiche and publishing. The model port, the store and the calendar / orders ports are the seams they plug into.
Retention is stored (`retentionMonths`) but not yet enforced by a purge job.
