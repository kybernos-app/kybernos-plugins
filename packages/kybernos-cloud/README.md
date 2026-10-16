# Kybernos Cloud — DSH plugin

Connects DSH to a **Kybernos Cloud** account and shows the profile in the interface:
email, name, plan, workspaces (name + number of Agent Teams) and session state.
On sign-in, **automatic import of the models** of the Kybernos LiteLLM proxy
(glm, deepseek…) according to the subscription — see “Imported model catalogue”.

A button in the bottom bar of the sidebar — in the slot
`sidebar.footer.action`, next to Settings — opens a card with three states:

| State | What you see |
|---|---|
| Disconnected | “Connect Kybernos Cloud” |
| Pairing | the device code, “Open activation page”, “Copy code”, “Cancel request” |
| Connected | email, plan, workspaces, “Disconnect” (the catalogue, the chats and the memory no longer have a button in this card) |

## Imported model catalogue (cloud feature no. 1)

When the user is signed in, the host half automatically imports the
catalogue of the Kybernos LiteLLM proxy into the harness:

```
GET <api>/v1/models        (Authorization: Bearer <device token>)   ← <api> = BUILTIN_API (server-profile.mjs), the new server
   → { data: [{ id: 'kybernos/doer', … }, …] }    (OpenAI-compatible list)
```

- **Writes into `~/.dsh/settings.yaml`** (namespace `llm-pi-ai`) a `kybernos`
  provider route: `displayName: Kybernos Cloud`, `api: openai-completions`,
  `baseURL: <api>/v1`, `apiKeyEnv: KYBERNOS_API_KEY`,
  `models: [{ id, name }, …]`. The write goes through the `settings` service
  (the same path as the native Models page) — the models appear in
  Settings → Models and in the model selector, without a restart.
- **Sets the credential** `KYBERNOS_API_KEY` (the `kys-…` token) in the
  credentials store (`~/.dsh/.credentials.yaml`, 0600). The harness resolves the
  reference on every request: no secret in settings.yaml.
- **Filters the product surface**: only the `kybernos/*` routes are kept —
  not the fallback twins (`-fb1`, `-fb2`…), not the infra routing pools
  (`*_rg`), not the embeddings route (`kybernos/embed`). `max_tokens` /
  `context_length` from the catalogue are carried over when LiteLLM provides them.
- **Triggers**: at claim (sign-in), at DSH start-up if already
  connected, at refresh if nothing has been imported yet, and on demand
  (POST `/kybernos-cloud/models/sync`, no button calls it any more). An identical
  import rewrites nothing (no settings churn each time the card is
  opened).
- **The subscription is enforced by the proxy**, request by request (gating
  free < solo < studio < scale, fail-closed): the `GET /v1/models` catalogue
  is not filtered by plan, so DSH imports no tier logic —
  a model outside the plan will answer with the proxy's error when called.
- **Cleanup**: “Disconnect” or a revocation removes the `providers.kybernos`
  route AND the credential — but only what THIS feature set (recorded in
  the state: `models.provider`).
- **Degradation**: catalogue 401/unreadable/unreachable → explicit refusal
  (`catalogue_refuse`, `catalogue_illisible`, `reseau`), never a
  disconnection (revocation is decided on `/v1/workspaces`) and the previous
  import stays in place; `settings`/`credentials` services absent →
  `settings_absent`, reason shown in the card.

New local routes:

| Route | Response |
|---|---|
| `GET /kybernos-cloud/models` | `{ok, connected, plan, models:{provider, base_url, imported_at, plan, count, ids, settings, credential, cause}}` |
| `POST /kybernos-cloud/models/sync` | same contract + `wrote`/`reason` — resynchronises now (forced) |

The summary (`count`, `plan`, `imported_at`, `settings`, `credential`) also
travels in the `state` of the `/status`, `/poll` and `/refresh` responses. The
full ids stay in the detail route.

## The Team console in DSH: gone

`GET /kybernos-cloud/relay` is no more. It was how the server's console, framed read-only in DSH, read the account and the team (an allowlist of GET paths, the
token added by the host). The menu entries Team settings, Account and Referral open the app in the browser instead (`POST /kybernos-cloud/console/link`, ADR 0054
of the server), so nothing frames the console any more and the route, its allowlist and the page-side broker are removed (`docs/dev/frame-removal.md`).

## Settings › Kybernos (what stays on this computer)

The one Settings section of this bundle (`kybernos-local`, `KybernosSection` in `client.js`) holds the three local functions that used to sit
on the removed Account pages. It is shown whether connected or not; what needs a server says so when signed out (buttons disabled).
The account's own pages (profile, security, devices, data, support) are the server's pages, opened from the footer menu in the browser.

- **Custom instructions**: the field and its Save, through the two host routes below (a marked section of `<DSH home>/AGENTS.md`).
- **Models**: the line says what the last import did (count, plan, date) and that the list updates by itself (the host re-imports at the connection, at boot, at a server switch, on a change of space and when the catalogue changes at the 5-minute refresh). The by-hand button is not on the page: it is under a folded **Advanced** (`ky-adv-toggle`): « Re-import » runs `POST /kybernos-cloud/models/sync`.
- **DSH chats** (also under Advanced): one sentence says what is sent (the title and date of each DSH chat, never what is said in it), to whom (the person's Kybernos account) and why (the « DSH conversations » list of the web app). « Send DSH chats » then asks « Send the list now? »: only `Yes, send` runs `POST /kybernos-cloud/chats/push`; Cancel sends nothing. The last send is shown.

The "Custom instructions" field used to live in the browser only, so no agent read it.
It is now a marked section of `<DSH home>/AGENTS.md`, which DSH's own `dsh-agent-instructions` loader hands
to every new chat (user-global file first, then the project's):

| Route | Answer |
|---|---|
| `GET /kybernos-cloud/instructions` | `{ok, present, text, file}`: the section's text and the file's path (the page says where the text went) |
| `POST /kybernos-cloud/instructions/save` | body `{text}` (at most 2000 characters; an empty text removes the section) → `{ok, present, changed, file}` or `{ok:false, error}` |

- `instructions.mjs` owns the file logic: the section sits between `<!-- kybernos:custom-instructions v1 -->` and
  its closing marker, is replaced in place, and everything else in the file is left byte for byte. A Windows
  file keeps its line ends, a symlinked `AGENTS.md` stays a symlink, a write is tmp + rename.
- A marker typed in the field is refused (`reserved`), and a file with an opening marker but no closing one is
  refused (`markers-damaged`) instead of guessed at.
- The write is strict same-origin like the other mutating routes, and the page keeps the text unsaved with the
  reason when the write fails. Without the route (an older host) the field stays browser-side.
- Applies to **new** chats: DSH loads the file for the first request of a conversation.

## The footer menu: Upgrade, See plans, a server that does not answer

- **Upgrade** (connected): an entry after the plan row, for a plan that has something above it. It asks the host for the console link on the active
  workspace's plan page (`section: plan`, the call Team settings makes) and the host opens the system browser: nothing is bought from the menu. It is
  not offered on Free (that plan keeps its pill, which opens the in-DSH Upgrade dialog), on the top level of the individual plan or on a paid Team plan
  (the public catalogue, `GET /kybernos-cloud/plans`, says which is the top; not read = the entry stays), nor on a page that is not on loopback (a hosted
  DSH: the host is not the person's machine, and the server refuses a single-use link that a page started).
- **See plans** (signed out): opens the server's own `/account#plan` in a tab (the app signs the person in, then shows the plans).
- **A server that does not answer** (`status: 0`): `POST /kybernos-cloud/console/link` and the seam
  (`globalThis[Symbol.for('kybernos.cloud')].call`) answer with `server: { name, host, can_switch }`: the active server's label and host, and whether the
  registry names another one. The footer's notice and kybernos-mobile's panel then say « the server “X” (host) does not answer » and, when `can_switch`,
  offer « Switch server »: Settings › Servers (the Servers module's page, cell key `kybernos-servers`; the phone link asks the footer for it with the window
  event `kybernos-cloud:servers`). Tests: `test-console-link.mjs`, `test-cloud-seam.mjs`, `test-cloud-client.mjs`; live: `scripts/check-footer-live.mjs`.

## Account memory (cloud feature no. 2)

DSH has **no native memory**: its instruction plan is capped at
65,536 bytes (`maxBytes` of the presets) and, beyond that, the loader **omits** the
least specific files. The user's durable memories therefore live where they are
already modelled: the `kybernos.memories` table of their account.

When the account is connected, this half does three things:

1. **It reads** `GET /v1/memories?scope=account` (and `?scope=kyber&kyber_id=` for
   each linked Agent Team) with the account's token, and fills a cache. The cache is **reloaded** when it is more than 60 s old (plugin timer, released with it), right after any write (tool, capture, card) and when the page opens; a read that fails **keeps** the old content and surfaces the error instead of emptying the prompt.
2. **It injects** the result into the prompt, at each assembly, via
   `ctx.systemPrompt.context({ name: 'kybernos:memory', order: 130, text })`.
   The text is **synchronous** (it reads the cache — never the network in an
   assembly), bounded to 6,000 characters **frame included**. The
   **selection** is by freshness: the pinned ones first (capped at 60% of the
   budget, most recent first), then the most recent free memories, and
   a memory too long for what remains is skipped. The **rendering** keeps the
   deterministic order of the server spec (`pinned DESC, created_at ASC, id ASC`, an
   unstable order breaks the proxy's prompt caching). The old sort “from oldest to
   most recent, cut at the first overflow” kept only the oldest: on an account
   with 631 memories, only 12 pinned ones fit and nothing of what the model had just
   learned. When memories remain outside, the chunk says so and points to
   `memory_search`. The linked Agent Teams have their share (30%) so that one group
   does not starve the other. This is a **provisional** step: the real answer is a
   relevance search on the server side. The content is neutralised: a memory cannot
   forge a chunk line.
3. **It lets you write**: two tools (`memory_write`, `memory_search`) and an
   **automatic end-of-turn capture** (`agent/turn-stopping`) that asks the
   model in place, in the background (300 tokens max), what is worth
   remembering — then writes it into the account (`kind` chosen by the model, `source:
   conversation`). This hook is awaited **serially** by the agent loop:
   the capture is therefore *fire-and-forget*, it never delays the end of the turn.
   The text submitted for extraction **names the roles** (`UTILISATEUR :` /
   `AGENT :`): without a label, the model cannot tell a lesson taught by the
   user from a claim made by the agent.

   Two safeguards against a **feedback loop** observed live on
   22/09/2026 (memory #53 was the exact duplicate of #51): the capture
   rereads the messages of the turn, and the turn carries the injection that this plugin has just
   written into the prompt — the extraction was therefore rereading its own injection.
   (1) the injected block is **removed** from the submitted text (`stripMemoryBlock`);
   (2) a fact already present in the account is **not rewritten** (normalised
   comparison). Without the second, the same fact is written on every turn that carries it.

   The capture is *fail-open* by construction, hence **observable**: each
   exit writes a state (`hors_connexion`, `desactivee`, `sans_session`,
   `tour_trop_court`, `llm_indisponible`, `rien_a_retenir`, `deja_connu`, `ecrit`, `erreur`) that the route and the card display. Without
   that, “nothing to remember” and “the LLM service is missing” would look
   exactly alike — it is the same blind spot as “the panel is selected” without
   “the panel is visible”.

Local routes (same-origin guards and strict method, like the others):

| Route | Method | Role |
| --- | --- | --- |
| `/kybernos-cloud/memory` | GET | the account's list + cloud Agent Teams + mapping + lesson counters |
| `/kybernos-cloud/memory/add` | POST | adds a memory (`{content, kind, source?, pinned?}`) |
| `/kybernos-cloud/memory/update` | POST | pins / unpins / changes the retention (`{id, …}`) |
| `/kybernos-cloud/memory/delete` | POST | forgets a memory (`{id}`) |
| `/kybernos-cloud/memory/search` | GET | searches (`?q=`) |
| `/kybernos-cloud/memory/map` | POST | writes the local Agent Team → cloud Agent Team mapping |
| `/kybernos-cloud/memory/lessons` | POST | pushes the local lessons (`dryRun` by default) |
| `/kybernos-cloud/memory/list` | GET | **paginated and filtered** list of the account (`limit`, `offset`, `show`, `src`, `added`, `q`) |
| `/kybernos-cloud/memory/settings` | GET | the `memories`, `context`, `capture` switches, and `capture`: where the last capture stands (in memory only) |
| `/kybernos-cloud/memory/settings/set` | POST | sets one or more switches (booleans; refused as a whole otherwise) |

Each path is **distinct**: the router indexes by path, so two routes
on `/memory` would mask each other (defect found by the host suite).

### Settings, origin of writes, paginated list

- **Switches** (`memories`, `context`, `capture`, all true by default): file
  `kybernos-cloud-memory.json`, **next to** the state (0600) and not inside it, because the state
  disappears at disconnection whereas a “Memory: off” must survive a
  reconnection. `context=false`: no chunk; `memories=false`: no chunk, tools
  refused (`memoire_desactivee`), no capture; `capture=false`: the capture costs
  neither a network call nor a token (state `desactivee`). These switches govern **this
  plugin**: the Kybernos proxy also injects a memory block for the requests that
  go through it, and does not know about them yet.
- **Origin**: the server marks the capture, an agent's tool and the push of
  lessons with the same `source` (`conversation`). The plugin therefore records locally who wrote
  what (`kybernos-cloud-memory-origins.json`, 5,000 ids max): `capture`, `agent`,
  `taught` (the card), `sync`. For a memory written elsewhere, the origin is deduced
  from `source` and the list carries `originKnown: false`.
- **List**: `GET /kybernos-cloud/memory/list` computes on the cache, because
  `GET /v1/memories` returns everything and does not paginate yet. Each row carries `sent`,
  which comes from the **same** selection as the prompt: the screen cannot announce anything
  other than what the model reads. The search is textual (`search.mode: exact`,
  `relevance: false`).

### Agent Team mapping

The identifiers have nothing in common (local: `default`, `dev-team`… ; cloud:
`kg52d53f4ce522`…). The mapping is therefore **explicit and inspectable**
(`state.kyberMap`, editable from the card), never guessed: a local Agent Team that is not
linked pushes nothing, and the push report says so. The lessons go up as
`scope=kyber`, `kind=policy`, with **deduplication before writing** (content
already present is not rewritten). The most recent ones go first if the
cap of 40 cuts.

### Invariants

- offline: no chunk, the tools refuse, **no network request**,
  and above all not the cache of the previous account (`emptyMemoryCache()`, also called by
  `disconnect` — a test checks it);
- a refused read (401) **says it is refused** — it never disguises itself as
  “no memories” (an empty list and a dead token do not look alike);
- `kyber_id` is **not exposed to the model**: a model must not be able to target
  another's Agent Team (server spec §7);
- the injection is fail-open (no chunk ⇒ the turn continues), the read is
  fail-loud (the error surfaces all the way to the card).

## Team skills (server half)

A Team's private catalogue of skills: any member proposes one, an owner or admin approves it, every member can install it. This
package only talks to the server (contract: `docs/dev/team-skills-contract.md`, routes under `/v1/workspaces/{id}/skills`) with the
account token, for the **active** workspace, and only on the Team plan (the same `teamWorkspace` rule as the lessons). It never
reads or writes a skill on disk: `kybernos-skills` does (`team/pack`, `team/install`), and the page carries the files between the two.

| Route | Does |
| --- | --- |
| `GET /kybernos-cloud/team/skills?view=approved\|proposed\|mine\|all&limit=&offset=` | a page of skills (metadata), with the caller's role and the counts |
| `GET /kybernos-cloud/team/skills/item?id=` | one skill with its files |
| `POST …/add` `{name, description, files, note?}` · `…/review` `{id, decision, note?}` · `…/retire` `{id}` · `…/delete` `{id}` | propose (an admin's skill is approved at once), approve or reject, retire, withdraw |

Every refusal of the server is returned as one word (`team-skills.mjs`: `admin_required`, `scan_rejected`, `invalid_skill` with its
`reason`, `duplicate`, `not_on_this_server` for a server without the routes, …). The server's own text never reaches the page.
`node packages/kybernos-cloud/test-team-skills.mjs` (13 checks, stand-in server).

## Kybernos connections (the account's connected apps)

The person connects Gmail or GitHub once, in the web app or in DSH, through the **server's own Composio Platform project** (not a key typed
on a machine: ADR 0008 of the Kybernos server), and every agent of theirs can then use it. This package holds the DSH half; it exists only
for a server whose profile says `services.connections` (an address, on the server's own origin; absent or `false` = not offered: no route
answers, no tool is registered, nothing is sent: `docs/dev/servers.md`). Pure half in `connections.mjs` (paths, the five statuses, one word
per refusal, row mappers, JSON-RPC), host half in `connections-host.mjs` (routes and tools), glue in `index.js`.

| Route | Does |
| --- | --- |
| `GET /kybernos-cloud/connections[?refresh=1]` | `{ offered, connected, connections: [{id, toolkit, status, accountType, alias, isDefault, createdAt, failure}], limit, entitled, count, web, stale }`; `status` is `pending`, `active`, `failed`, `expired` or `disabled` |
| `GET …/connections/apps` | the toolkits that may be connected: `{ apps: [{slug, name, categories, description, needsApiKey}] }` (no logo: it is a third-party address) |
| `GET …/connections/item?id=` | one connection, reconciled at the server on the spot: what the page **polls** (every 5 s) while an add is pending |
| `POST …/connections/link` `{toolkit, api_key?, alias?}` | starts one: `{ connection: {id, status}, redirectUrl }` (the page opens `redirectUrl` in a new tab); never a `redirect_uri` (the server uses its own page), never a user id; an `api_key` is sent in this one call and never kept, logged or answered back |
| `POST …/connections/delete` `{id}` | disconnects, at the third party and in the server's table |

Refusals are one word: `connection_limit` (with `limit`, `count` and, from a server that says it, `entitled`: `false` means the plan does not include connecting apps, so the page offers the plans instead of a limit to reach), `pending_exists` (with `existing: {id, toolkit, status}`, so the page can offer
“cancel it”), `needs_api_key`, `connection_failed` (the app refused the key), `upstream_unavailable` (with `checkFirst`: an add that may have gone through, so **list before trying again**; an add is
never sent twice), `connections_disabled`, `reconnect_required`, `not_found`, `not_on_this_server`, `network`. Nothing leaves the machine when
the server does not offer connections or the account is not connected.

**Three native tools** for the agents, registered while the server offers connections AND the account is connected, and removed when either stops
(checked every 5 s, so a pairing, a disconnect or a change of server needs no restart): `connections_list` → what is connected, `connections_search_tools`
`{toolkit, query?, limit?}` → the actions of an app, `connections_execute` `{tool_slug, params, connection_id?}` → runs one with the person's own
account. They are registered here and not as a `dsh-mcp-client` entry because an entry's headers are fixed when it loads: it would keep the token it
started with through a re-pairing. Each call posts one JSON-RPC `tools/call` to the endpoint with the live token (stateless: no `initialize`); the person
is named by the token alone, never by an argument. `connections_execute` acts for real and is not retried.

`node packages/kybernos-cloud/test-connections.mjs` (26 checks, a stand-in server that speaks ADR 0008; the engine's own JSON-schema rules are
checked for each tool where DSH is installed, `NO_DSH_ENGINE=1` skips them).

## Share panel: members

`POST /kybernos-cloud/members/invite` with `{email, role}` creates a pending invitation (`POST /v1/workspaces/{id}/invitations`, which sends the mail; answers `invited: true`) and with `{user_id, role}` adds an existing user (`POST …/members`); the refusals the panel can act on come back as one word: `already_member`, `seat_limit`, `forbidden`, `rate_limited`.

## Why a separate package

The client half of a Cordis plugin must fit in **a single** `client.js`: the
DSH loader evaluates `window.__ModuleLoader__.load({ id, factory })`, there is neither a
bundler nor an import of a neighbouring file. This package therefore keeps the cloud integration
isolated from the `@local/kybernos` plugin (the local plugin for Agent Teams), which avoids
write collisions and makes each half deliverable independently.

## How it works (device code flow, RFC 8628)

```
DSH (host)                    <api> (the active server)         browser (already signed in)
   │ POST /v1/device/start ───────▶│
   │ ◀── device_id, device_secret, user_code, activation_url     │
   │ window.open(activation_url) ───────────────────────────────▶│ /cloud/cli/activate
   │                               │ ◀── POST /v1/device/approve ─┘ (Supabase JWT, fresh-iat)
   │ POST /v1/device/poll (2 s) ──▶│  approved → `kys-…` token minted at claim
   │ ◀── { token, user{id,email,name,plan} }        (once only)
   │ GET /v1/me + /v1/workspaces (Bearer kys-…) → live profile
```

The claim carries only a **snapshot** of the profile. Every refresh
therefore calls `GET /v1/me` again (name, plan — the same source as the claim) in addition to
`GET /v1/workspaces`: a name filled in or a plan upgrade on the Kybernos
side comes through without re-pairing. An older server that does not know
`/v1/me` (404) simply leaves the profile in cache. If `name` is empty —
which is the case today, no product path writes `kybernos_users.name` —
the card shows the **local part of the email**, greyed out and annotated as a
fallback, rather than a mute “—”. This fallback is the **decision taken** (19/09),
not a stopgap: writing a real name at the source — sign-up onboarding
or a Profiles screen on the Kybernos side — remains a product option, not planned.

The password is entered **in the browser**, on the page served by
Kybernos. This plugin never sees a password, a Supabase key or a LiteLLM
key: it stores only the opaque `kys-…` token, the same kind of token as
a web session — revocable from the Kybernos app (**Security → Sessions**,
the device appears as `DSH <machine name>`).

## Security invariants

1. **No secret in the repository.** The state lives in `~/.dsh/kybernos-cloud.json`,
   created with **0600** (the folder 0700). It is *outside* the repository, never committed.
2. **The token does not leave the host half.** The `/kybernos-cloud/*` routes
   return only `{ user, workspaces, device_label, expires_at }` — never the
   token, never the device secret. The client half only calls them.
3. **The device secret disappears at claim.** After the first successful poll,
   `device_secret` and `user_code` are removed from the state file.
4. **Same-origin.** The mutating routes refuse any origin different from
   the host's (403), like the other local routes of the plugins.
5. **Real revocation.** “Disconnect” calls `DELETE /v1/session` on the
   server side (the token also dies for anyone who might have copied it), then erases the local
   state. If the Kybernos app revokes the session, the next refresh
   returns 401 → the card shows “Reconnection required”.

## Activation

The DSH web profile loads plugins by link. Add the dependency and the
bundle, install, then restart DSH (the profile does not hot-reload
for a bundle that is still absent):

```bash
# 1. /Users/<you>/.dsh/profiles/web/package.json
#    "dependencies": { … , "@local/kybernos-cloud": "link:/path/to/dsh-kybernos/kybernos-cloud" }
#    "dsh": { "profile": { "bundles": [ … , "@local/kybernos-cloud" ] } }

# 2. link + install
cd ~/.dsh/profiles/web && pnpm install

# 3. restart DSH (the bundles are resolved at start-up)
```

> **Already done on this machine (2026-09-19)**: the dependency and the bundle are
> registered in `~/.dsh/profiles/web/package.json`, the link
> `node_modules/@local/kybernos-cloud` is in place, and the profile that serves the
> GUI hot-reloaded the bundle (`patchReload: live`) — verified by
> `GET http://127.0.0.1:3080/kybernos-cloud/status` → `{"ok":true,…}`.
> Backup of the profile before the change:
> `~/.dsh/profiles/web/package.json.bak-20260919-avant-cloud`.
> To roll back: restore that backup, delete the link, and
> `POST /kybernos-cloud/disconnect` before removing the entry from the bundles.

Variant without a restart: the session that has the `cordis_*` tools can
define the plugin hot with the content of `index.js` (host) and `client.js`
(client) — same mechanism as the `kyber-1` plugin.

## Configuration

| Variable | Default | Role |
|---|---|---|
| `KYBERNOS_CLOUD_API` | `BUILTIN_API` of `server-profile.mjs` (the new server; at go-live only this constant changes) | API base; replaces the address of the active server (web, console and connections follow). The old stack remains reachable through a `servers.json` entry (docs/dev/servers.md) |
| `KYBERNOS_CLOUD_STATE` | `~/.dsh/kybernos-cloud.json` | state file (tests, multiple profiles) |

The origin of the activation page comes from the server (`activation_url`), so
there is nothing to configure on the client side.

## Tests

```bash
node scripts/test-cloud.mjs                 # both suites at once
node kybernos-cloud/test-cloud-host.mjs     # 46 checks, fake local Kybernos
NODE_PATH=<node_modules with react> node kybernos-cloud/test-cloud-client.mjs   # 3 static + render
# react/react-dom are not dependencies of the repository: without them, the
# client suite skips cleanly. Otherwise:
KYBERNOS_CLOUD_REACT_DIR=<node_modules with react> node scripts/test-cloud.mjs
```

Since the memory work, the **client** suite starts with a **static** stage that
runs even without react (wiring of the memory section + completeness of the two
dictionaries: 61 literal keys present in fr **and** en). Without it,
the absence of react turned the suite into a silent “all green”.

The **visual proof** of the memory is a separate script:

```bash
node scripts/check-cloud-memory-ui.mjs   # opens the card and MEASURES the rendering
```

It reads the URL with a token (the bare URL answers “dsh web authentication required”),
opens the card, checks that the section is actually rendered, that what the
card shows matches what the account contains, that the controls are
in the card, and that the label of the primary button reaches a 4.5:1 contrast
(this measurement is what found a white label on a nearly white background, ratio
1.0: the “Connect” CTA had always been unreadable — the alias
`--dsw-alias-brand-primary` is a **text** colour in this theme, not a
background). The two checks that depend on the age of the host half in memory are
flagged “PENDING”, never green.

The host test mounts the real routes on a fake `webServer` and runs the full
cycle (start → pending → claimed → profile → revocation), including the
401 cases, network down, origin refused, invalid method, 0600 permissions and
absence of token leakage — plus the catalogue cycle: import at claim (`kybernos/*`
filter), settings write + credential, forced manual sync, catalogue
401/unreadable, services absent (degradation), cleanup at revocation and at
disconnection. The client test replays the `__ModuleLoader__.load`
contract, checks the slot registration and the React rendering.

## Troubleshooting

- **The button does not appear** → the bundle is not loaded: check the two
  entries in the profile's `package.json`, `pnpm install`, and the restart.
- **“No models imported”** → the catalogue could not be read
  (`catalogue_indisponible`, `catalogue_illisible`, `reseau`): disconnecting then
  reconnecting restarts the import; if the import is partial, the
  `settings` service refused the write (`settings_refuse`) — look at the DSH
  log.
- **A model answers 403** → the subscription does not include its plan: gating
  is applied by the proxy, at call time (fail-closed), not by DSH.
- **`demarrage_impossible`** → the API is unreachable or the variable
  `KYBERNOS_CLOUD_API` points at the wrong environment.
- **`trop_de_demandes`** → the per-IP limit of `/v1/device/start` (10/min): pending
  requests expire after 10 minutes.
- **“Reconnection required”** → the session was revoked (or expired on the
  server side, 30-day sliding TTL without a call): click “Reconnect”.

## Kaby (ADR 0053 of kybernos-server)

The routes the **Kaby** page (`kybernos-kyber`) uses; the shapes and the words of a refusal are in `kyby.mjs`, tested by
`test-kyby.mjs`. All add the account's token; every refusal is a short code word, never the server's text.

| Route | Does |
|---|---|
| `GET /kybernos-cloud/kyber` | the door's state, the person's cloud computers and the one linked to the assistant (`home`; `manual_control`: false on the Free plan) |
| `POST /kybernos-cloud/telegram/pairing` | asks for a pairing: `{ id, link, bot, expires_at, qr: { size, modules } }` (the QR is computed here, `qr.mjs`) |
| `GET /kybernos-cloud/telegram/pairing/state?id=` | `{ state: waiting\|scanned\|done\|declined\|expired, reason?, sender? }` |
| `POST /kybernos-cloud/telegram/pairing/cancel` `{id}` | “it is not me” |
| `POST /kybernos-cloud/kyby/computer` `{computer_id}` | the cloud computer linked to the assistant (null = the default Home); `GET /kybernos-cloud/kyber` lists `computers` and gives `home` as the chosen one |
| `POST /kybernos-cloud/telegram/unlink` | disconnects the account's Telegram |
| `GET /kybernos-cloud/kyby/native` | which DSH chat is Kaby's (`sessionId`, null before the first time) and its folder (`cwd`, made here) |
| `POST /kybernos-cloud/kyby/native/set` `{sessionId}` | remembers that chat (null forgets it) |

Kaby's own chat is a native DSH conversation (`kyby-native.mjs`): the host gives that chat Kaby's identity in the system prompt
(`kybernos:kyby`, for its session only), writes each finished turn on the person's server thread (`POST /v1/threads/{id}/messages`, the
thread from `GET /v1/me/kyby`) and tells the prompt what was said there lately. A server with no such thread is left alone for ten minutes.

`qr.mjs` is a byte-for-byte copy of `kybernos-mobile/qr.mjs` (bundles do not import each other): `node scripts/test-qr-drift.mjs`
fails when they part. The footer publishes `window.__KB_UPGRADE__.open()` so a page can open the Upgrade dialog.
