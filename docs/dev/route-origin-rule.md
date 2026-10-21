# The origin rule of the host routes

DSH serves a plugin's routes **before** its own login (measured on `0.2.0-rc.2`: `/` answers 401, `/kybernos-hub/state` answers 200), and an
`Origin` header is forgeable by any local program or any other account on the machine. So a route that spends the person's money, deletes their
data, installs software or stores a key cannot rely on an Origin check. Decision D3 of the pre-production audit (2026-10-16), **narrow**: the
signed DSH session cookie, on top of a strict same-origin request, only on the write routes the audit names; every other route keeps the rule of
its bundle, and a route with a caller that is not a browser stays open and says why in a comment.

A-16 of the platform audit (2026-10-20) found **48 write paths still at the `origin` level** (43 write routes and 5 that answer every method
alike; 31 of them in `kybernos-cloud`): a local program sending **no** `Origin` header passed, which the rule above forbids. The same audit
found three more holes in the same family: A-15 (a widget route deleted a conversation file with no guard at all), L6-02 (the master bundle
imported `writeGuard` but applied it to its three feedback routes only) and L1-01 (`kybernos-call` guarded secret writes with
`sameOriginStrict` alone). This page is the ledger of what was converted, what stayed, and why.

## The rule

A write route needs **both**:

1. a strict same-origin request: an `Origin` (or `Referer`) naming this listener (`127.0.0.1`, `localhost`, `[::1]` on the socket's port, or an
   authority declared to DSH with `--trusted-host`); no header at all is a **403**;
2. DSH's signed browser-session cookie (`dsh-auth-<hash of the authority>`, signed with the machine secret in `.credentials.yaml`): missing, forged or
   expired is a **401**. The secret that cannot be read closes the write (**503**), as the terminal's run route does.

`kybernos-terminal`'s run route was the first to ask for it; `kybernos-plugin`'s `/kybernos/tasks` is the second. `packages/<bundle>/session-guard.mjs`
is the terminal's own code, word for word (`autorites`, `origineOK`, `dshHome`, `lireSecretSession`, `cookieSessionValide`) plus one function that joins
them, `writeGuard(req)`, which answers `null` or `{ status, error }`. On a hosted instance the cookie is also looked up under the public authority when
DSH was told about it (`--trusted-host`), the way the scheduled-tasks route does; the signature must still be valid, so a forged `Host` gains nothing.

Bundles are installed on their own and import nothing from one another, so **each bundle that guards a write carries a copy** of `session-guard.mjs` and of
its test helper `lib-session-test.mjs`. `node scripts/test-session-guard.mjs` fails when a copy differs from the others or from the terminal's functions,
when a copy is not imported by a host file, and checks what the guard decides (no header, foreign Origin, right Origin without a cookie, forged and
expired cookie, the real pair, a hosted authority, an unreadable secret). To change the guard: change the terminal first, then copy the file everywhere.

To put a new write route under the rule: import `writeGuard` from `./session-guard.mjs`, call it after the method check (in the table-driven bundles,
`cloud`, `memory` and `computers`, add `session: true` to the row), answer its refusal, and add `packages/<bundle>/test-write-guard.mjs` (copy a neighbour):
each write with no Origin and no cookie, a foreign Origin, the right Origin without a cookie, a forged cookie, the real pair, and a check that a refused
request left the files and the outside world as they were.

## What is under the rule (the origin-rule audit, A6-22, plus A-16 / L6-02 / L1-01)

| Bundle | Routes |
|---|---|
| `kybernos-composio` | every write: the key (save, delete), the connectors (save, delete, **test**: it starts the connector's command), their command folders, the accounts, the provider choice, the API connectors |
| `kybernos-memory` | the nine POST routes: lessons add, update, delete, the tidy-up, the switches |
| `kybernos-auto` | `/session`, `/settings`, `/probe` (a probe spends tokens), and the write methods of `/models` and `/state` (A-16: those two answer every method alike, so only their reads stay behind the Host fence — any other method must name this listener's Origin) |
| `kybernos-modeles-locaux` | `/installer` (`brew install ollama`, `ollama pull`), `/annuler`; and (A-16) the two writes the Local models page makes: `POST /catalogue` (`{op:'refresh'}` downloads and verifies the signed catalogue) and `/decouvrir` (it stores the model ids seen last time). The catalogue READ keeps the strict rule alone |
| `kybernos-modeleur` | (A-16) `/push` (it writes the model a panel replays) and `/annote` (the strokes the person drew over it). Their caller is the panel; the agent's `modeliser` tool writes the store in-process |
| `kybernos-motion` | (A-16) `/frame` (the panel POSTs the rendered PNG back to the agent waiting for it) and `/export` (it writes a video next to the scene). Their caller is the Motion panel; the agent's `creer_motion` tool asks it through the store |
| `kybernos-bricks` | (A-16) `/push` (the brick model a panel replays). Caller: the panel; the `animer_briques` tool writes the store in-process |
| `kybernos-slides` | (A-16) `/push` (the deck and the annotations a panel replays). Caller: the panel; the `creer_slides` tool writes the store in-process |
| `kybernos-models` | the eight POST routes: the notes (`annotations/save`), the journal, the pasted-key check (`key/check`: it spends a call on the provider), park / take / forget a provider, `scores/list`, `scores/sync`; and `modelsdev?force=1` (a forced 4.7 MB download). The reads stay open behind the Host fence |
| `kybernos-computers` | the nine POST routes: the E2B key, start, exec, write, stop, pause, resume, the environment switch (they run on the person's key and bill) |
| `kybernos-cloud` | **every POST route a page drives** (A-16: the 31 that were at the `origin` level, on top of the eleven the earlier round named). That is the memory (add, update, delete, lessons, the index batches, the mapping, the tidy-up scan / apply / dismiss / undo / settings), the space (active, applied, create, folder, for-folder), the team (lessons add / delete / review / retire, skills add / delete / review / retire), the connection (link, delete), the members (invite, remove), the invitation (accept), the shares (set, revoke), the artifacts (push, detail), the chats (ensure, push) and the profile/device writes (start, poll, refresh, disconnect, models/sync, marketplace/install, kyby/native/set). Two POST families keep the strict rule alone: `server/apply` and `turn*` (see the exceptions) |
| `kybernos-miniapps` | `/install` (writes a native app and launches it), `/uninstall` |
| `kybernos-plugin` | L6-02: the socle writes that were behind `sameOriginStrict` alone — `/kybernos/save` (rewrites `kyber.yml`), `/kybernos/create`, `/kybernos/workspace-ui-save`, `/kybernos/workspace-delete` (removes a workspace and purges its UI store), `/kybernos/pins`, `/kybernos/share`, `/kybernos/active-set`, `/kybernos/avatar-save` — plus the three they already had (`/kybernos/feedback`, `/feedback/export`, `/feedback/send`). The GET routes of the bundle keep their strict same-origin rule |
| `kybernos-call` | L1-01: `/keys` (writes the LiveKit / Groq / ElevenLabs / LiveAvatar keys), `/engine` (it installs the call engine: venv and `pip install`), `/clone`, `/test` (one provider call), `/preset`, `/avatars` (it asks the face provider). The page of the settings tab sends both halves |

Every one of them is called by a page, so the browser sends the Origin and the cookie itself (`scripts/check-write-guard-live.mjs` clicks the Auto
Routing, Memory options and Cloud computers pages in a real GUI and reads what the browser got back). The phone link (`kybernos-mobile`) replays a phone's
requests with `Origin` and the machine's cookie, so it passes too.

## What stays open, and why

- **A documented caller that is not a browser.** `/kybernos-auto/router` and `/report`: `cli/auto-router.mjs`, which the agent runs, sends no Origin and has no
  session. `/kybernos-cloud/turn*`: the computer's own runner
  (strict Origin only, as before). **`/kybernos-cloud/server/apply`** (A-16): it is a real write a page also makes (the servers page), but
  `packages/kybernos-servers/host.mjs` calls it over loopback with this listener's `Origin` and **no cookie** when it applies the active server, so it keeps
  `strict` (a bare program with no header is now refused, where it used to pass) and the loopback call must be widened to the cookie before it can join the
  full rule. A foreign Origin is still refused on all of them.
- **`/kybernos/slash/entries` (POST): the exception is CONTRADICTED, and this is the one route A-16 leaves open.** It was written here as "the
  `slash-msgaction-creator` skill writes through it", but two **pages** write through it too — `packages/kybernos-slash/client.js` (the entry editor's
  add / delete / restore) and `packages/kybernos-plugin/client.js` (the startup upsert of the `/widget` entry, `credentials: 'same-origin'`). So it has a
  browser caller *and* an agent caller without a session, and neither a plain conversion nor a documented exception is honest. The decision to take is one
  of: give the route the cookie and give the skill a named host-side path (or a tool) instead of the route, or add an explicit second credential for the
  local caller. Measured by the verifier on `6c0d055`, not read here: `node scripts/audit-routes.mjs --table` still shows it `origin`.
- **The free-models gateway** (`/free-llms/v1/chat/completions`, `/v1/models`, `/status`, `/health`, A6-04). Its caller is DSH's engine: no Origin, no cookie, no
  browser header. It cannot ask for a session, so it refuses what a *browser* marks as another site: a foreign `Origin`, or `Sec-Fetch-Site` other than
  `same-origin` / `none`. A page the person merely visits can no longer make their machine call opencode.ai. (A browser too old to send `Sec-Fetch-Site` looks like
  the engine for a no-cors GET: only `/health` and `/status` can be reached that way, and DNS rebinding is stopped by the Host fence.)
- **Public by design:** `/kybernos/widget/api/message` and `/kybernos/widget/api/account` (a website's widget: the visitor is on another site, has no DSH
  session, and their own message is the whole exchange) and `/kybernos/hooks` (the webhook receiver; each task's own secret is its fence). **A-15 fixed the
  odd one out:** `POST /kybernos/widget/api/history-delete` used to delete a conversation file with no guard at all. The host now mints a per-conversation
  token when it creates the conversation, hands it back **once** in the answer to `/message`, stores it in the conversation's own record (never in the GET
  listing) and refuses a delete without it (**403**, nothing on disk moves). The token is the visitor's fence, not a session: the widget stays reachable
  from any site (`packages/kybernos-plugin/test-widget-history-delete.mjs`).

## The counts, measured

`node scripts/audit-routes.mjs` is the evidence, measured and not claimed: it mounts every bundle's routes in-process under Node's permission model (no spawn, no
network, writes only in a throw-away home) and sends each route and method four requests (foreign Origin; no header; right Origin; right Origin and the signed
cookie). `--table` prints one line per route, `--json` the raw rows, `--root DIR` judges another checkout (a `git archive` of an earlier commit gives the "before").
Measured on 2026-10-16, 384 routes of 31 bundles, 249 of them answering a write method; the second column is the same table replayed on the 2026-10-21 tree after
A-16 / L6-02 / L1-01 / A-15 (447 routes of 34 bundles, 274 answering a write method):

| Write routes | Before (2026-10-16) | Now (2026-10-21) |
|---|---|---|
| strict same-origin **and** the session cookie | 3 | **116** |
| strict same-origin (an Origin or Referer is required, a local program can send one) | 139 | 147 |
| a foreign page is refused, a local program with no header is not | 86 | **4** |
| a page of any site can drive them | 18 | **3** |
| need a state the empty test home lacks, or a token the probe does not have (`kybernos-motion`; the widget's conversation token) | 3 | 4 |

The `origin` column is the one A-16 measured: 43 write routes before this round, **4 now**; and the routes that answer every method alike fell from **5 to 3** at
the `origin` level (the two `kybernos-auto` ones now answer their write methods at the `strict` level). Of the four write routes left, **three are the documented
non-browser callers above**; the fourth, `/kybernos/slash/entries`, is the one route A-16 leaves open — it is written by pages too, so its exception is
contradicted and the decision is described above:

| Bundle | Routes left at `origin` | Caller that keeps them there |
|---|---|---|
| `kybernos-auto` | `/report`, `/router` (POST) | `cli/auto-router.mjs`, run by the agent: no Origin, no session (documented above) |
| `kybernos-free-llms` | `/v1/chat/completions` (POST; its `/v1/models`, `/status` and `/health` are the every-method rows) | DSH's engine: no Origin, no cookie (documented above) |
| `kybernos-slash` | `/entries` (POST) | **pages AND the skill**: `kybernos-slash/client.js` (the entry editor) and `kybernos-plugin/client.js` (the `/widget` upsert) write it with the cookie; `slash-msgaction-creator` writes it with no Origin and no session. Contradicted exception — the one open route, see above |

Every other write route is under the rule. No route that used to answer a write fails for its real caller: the bundle harnesses (`test-cloud-host.mjs`,
`test-account-state.mjs`, `test-unplug-host.mjs`, `test-write-guard.mjs` of each bundle) call the converted routes the way the page does — the right Origin
**and** the signed cookie — and the live checks that stay green drive the real pages. The five bundles converted last (modeles-locaux, modeleur, motion, bricks,
slides) each carry their own copy of `session-guard.mjs` and a `test-write-guard.mjs` that proves the four refusals and the real pair; motion and slides also
prove that the source they build their `client.js` from is unchanged (`scripts/build.mjs --check`).

Two GET routes left the table with the read-only account frame (WP-24, `docs/dev/frame-removal.md`): `/kybernos-cloud/relay` and `/kybernos/ws-console-key`,
both strict (an Origin or Referer of this server was required). The routes are now 386 (388 before), 183 of them answering GET, 11 of those at the strict level;
no write route is concerned by this removal. Both existed only to hand the account's data (or a key) to the framed console through the DSH page; neither answers
any more.

## The reads (A6-05), not changed

The 70-odd data GET routes send no CORS header (the widget routes apart), so a foreign page cannot read them; what remains is a local process or another OS user
(no cookie needed), and a no-cors GET that triggers work. A GET carries no Origin from its own page, so the useful guard for a read is the **session cookie
alone** (the gate's copy of DSH's cookie is `SameSite=Strict`, so a foreign page's request would not carry it; DSH's own attribute was not measured here, check it first). Those that return what the person typed or the machine's layout:

- **Chat content:** `/kybernos/search-content` (searches the text of the sessions), `/kybernos/calls` and `/calls-index`, `/kybernos/runs` and `/runs-index`,
  `/kybernos/insight`, `/kybernos/load` (sessions, projects and the home path), `/kybernos/doc-raw`, `/kybernos/quality-feedback` and `/quality-rating` (the
  person's comments), `/kybernos-cloud/chats/detail` (the whole chat; open to the dev webapp origins on purpose, with a targeted CORS header: leave it).
- **Keys and accounts:** none returns a key's value. `/kybernos-cloud/status` and `/server` name the account and the server, `/kybernos/voice/config` the key references,
  `/kybernos/composio/connections` the connected apps and their account ids.
- **Paths and machine:** `/kybernos-skills/skills`, `/status` and `/featured` (the skills folders), `/kybernos-models/journal`, `/kybernos/tools/state`, `/kybernos/tts/cache`,
  `/kybernos/slash/entries` and `/status`, `/kybernos-miniapps/list`, `/modeles-locaux/machine` (chip, memory, models installed), `/kybernos/workspace-usage`.

Proposal: the session cookie on the chat-content group first (`search-content`, `load`, `runs`, `runs-index`, `calls`, `calls-index`, `insight`, `doc-raw`,
`quality-*`), then on the paths group. Two things to settle before: `kybernos-dashboards` fetches `/kybernos/load`, `/runs-index` and `/kybernos-skills/skills` from its page
(fine: the browser sends the cookie), but `kybernos-call` reads `/kybernos/voice/config` and `/voice-sample-audio` from its **host** over loopback with no cookie, so those two
stay as they are or the call host learns to send the cookie; and `/kybernos/onboarding` is read by `scripts/sandbox/setup.sh`.
