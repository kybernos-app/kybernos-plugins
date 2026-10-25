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

A write that came **through the phone link** never passes either: `kybernos-mobile` marks every request it replays from a paired phone with `x-kybernos-tunnel` (and drops any
marker a phone sends), and `writeGuard` answers **403 `refused_on_phone`** to a non-read request that carries it, whatever its Origin and cookie (both are then the person's own, so the marker is
the only thing that tells a stolen phone from the browser). A read of a cookie-guarded route stays open to the phone. `kybernos-terminal`'s run route and the task routes of `kybernos-plugin`
(`kbTasksRefused`, which keep their own cookie check) refuse the marker the same way. `node scripts/test-tunnel-routes.mjs` enumerates every cookie-level write route (through
`scripts/audit-routes.mjs`, probe E) and fails on one that lets the marker through.

Four POSTs only read, and a phone's pages ask for lists and for the text of something with a POST, so a phone may make them. They are the whole exception, a table in `scripts/test-tunnel-routes.mjs` (what makes each a read,
the body that must pass, the bodies of the same route that must still be refused): `/kybernos/tasks` with `{ action: 'list' }` (any other action creates, changes, deletes or runs an automation;
the list sent to a phone carries no webhook secret), `/kybernos-models/models/live` (one GET of the provider's model list, nothing stored; its siblings `models/probe`, `key/check` and the
provider routes stay refused), `/kybernos-skills/skill/read` (the SKILL.md of a listed skill, which the Skills page of a phone opens; its siblings reveal, duplicate, delete, install, toggle, create,
covers/make and index-source/set stay refused) and `/kybernos-search/query` (a search of the index the desktop kept on disk; `start` and `reindex` stay refused, so a phone searches what the
desktop has indexed). `writeGuard(req, { phoneMayRead: true })` is how a route that has checked, in its own source, that its POST only reads says so; nothing else excuses the marker.

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
| `kybernos-motion` | (A-16) `/frame` (the panel POSTs the rendered PNG back to the agent waiting for it) and `/export` (it writes a video next to the scene); (2026-10-24) `/save`, `/open` and `/restore`, which passed with no Origin at all. Their caller is the Motion panel; the agent's `creer_motion` tool asks it through the store |
| `kybernos-mobile` | (2026-10-24) the phone-link routes that change who can reach the computer: `remote/enable`, `pair`, `pair/approve`, `pair/deny`, `pair/cancel`, `devices/revoke`, `devices/revoke-all`. `pair` then `pair/approve` linked a stranger's phone on a forged Origin. Their caller is « Phone and channels » (the account menu's window and Settings); `remote/status` is a read and stays Origin-only. `scripts/mobile-remote-up.mjs` signs in with the isolated DSH's cookie |
| `kybernos-bricks` | (A-16) `/push` (the brick model a panel replays). Caller: the panel; the `animer_briques` tool writes the store in-process |
| `kybernos-slides` | (A-16) `/push` (the deck and the annotations a panel replays). Caller: the panel; the `creer_slides` tool writes the store in-process |
| `kybernos-models` | the eight POST routes: the notes (`annotations/save`), the journal, the pasted-key check (`key/check`: it spends a call on the provider), park / take / forget a provider, `scores/list`, `scores/sync`; and `modelsdev?force=1` (a forced 4.7 MB download). The reads stay open behind the Host fence |
| `kybernos-computers` | the nine POST routes: the E2B key, start, exec, write, stop, pause, resume, the environment switch (they run on the person's key and bill) |
| `kybernos-cloud` | **every POST route a page drives** (A-16: the 31 that were at the `origin` level, on top of the eleven the earlier round named). That is the memory (add, update, delete, lessons, the index batches, the mapping, the tidy-up scan / apply / dismiss / undo / settings), the space (active, applied, create, folder, for-folder), the team (lessons add / delete / review / retire, skills add / delete / review / retire), the connection (link, delete), the members (invite, remove), the invitation (accept), the shares (set, revoke), the artifacts (push, detail), the chats (ensure, push) and the profile/device writes (start, poll, refresh, disconnect, models/sync, marketplace/install, kyby/native/set). **2026-10-25 (recette L3-04, L3-05): the fifteen that had stayed at the Origin alone** — the Account page's `instructions/save` (it rewrites `<DSH home>/AGENTS.md`, which every agent reads, and an agent has a shell), the Telegram and WhatsApp `pairing`, `pairing/cancel` and `unlink` (a pairing link, opened and confirmed in the other chat, connects it to the account's Kaby), `kyby/computer`, the Home computer's `computer/open`, `resume` and `suspend`, `console/link`, `billing/checkout`, `billing/portal` and `invitation/preview`. Five POST routes keep the strict rule alone, each with the caller that is not a browser written in its `noSession` field (see the exceptions): `server/apply`, `turn`, `turn/answer`, `turn/continue` and `computer/claimed`. `test-write-guard.mjs` reads the ROUTES table and fails on a POST row that is neither `session: true` nor one of these |
| `kybernos-miniapps` | `/install` (writes a native app and launches it), `/uninstall` |
| `kybernos-plugin` | L6-02: the socle writes that were behind `sameOriginStrict` alone — `/kybernos/save` (rewrites `kyber.yml`), `/kybernos/create`, `/kybernos/workspace-ui-save`, `/kybernos/workspace-delete` (removes a workspace and purges its UI store), `/kybernos/pins`, `/kybernos/share`, `/kybernos/active-set`, `/kybernos/avatar-save` — plus the three they already had (`/kybernos/feedback`, `/feedback/export`, `/feedback/send`). 2026-10-24 (interfaces audit): the Agent Team writes `/kybernos/yml-appliquer`, `/ui-save`, `/menu-save`, `/insight-save`, `/team-portraits`, `/member-portrait` and `/voice-sample` (POST and DELETE; its GET list stays a read), and `/kybernos/art-action` (delete, rename and duplicate of a Creations file). Team automations, the local half (born with the pair): `/kybernos/automation/team-pack`, `team-copies`, `team-install` and `team-update` (POST: they carry prompts and an install or update writes `tasks.json`). 2026-10-25 (recette L3-06, L3-19): the writes that change what the agent follows or can do — `/kybernos/workspace-instructions` (the system prompt of a project's chats and its AGENTS.md), `/tools/apply` (it mounts Computer Use, Browser Use or a coding agent in `cordis.patch.yml`, reloaded at once), `/workspace-skills`, `/workspace-connectors`, `/domain/skill`, `/model/auto`, `/tts/config`, `/onboarding`, `/art-progress`, `/project-data` — and the ones that spend the owner's model or key — `/image/generate`, `/i18n-translate`, `/i18n-job` (POST), `/starters-suggest`, `/yml-proposer`, `/salary-detect`, `/models/audio/speak`. Four spending routes are the exception below. The same day, eight more POSTs that only pages drive: `/kybernos/gateway/approvals/decision` (it answers an agent's request for approval: a program that sent the Origin could say yes), `/voice/save`, `/i18n-store` and `/i18n-packs` (POST only: the GET keeps its lax rule), `/tts/cache-trim`, `/quality-feedback` and `/quality-rating` (POST only), `/art-reveal`. The GET routes of the bundle keep their strict same-origin rule |
| `kybernos-call` | L1-01: `/keys` (writes the LiveKit / Groq / ElevenLabs / LiveAvatar keys), `/engine` (it installs the call engine: venv and `pip install`), `/clone`, `/test` (one provider call), `/preset`, `/avatars` (it asks the face provider). The page of the settings tab sends both halves |
| `kybernos-hub` | (2026-10-25, L3-14) the five POSTs of the Suite panel and Maintenance: `/module` (activate, deactivate, **install** a module), `/relaunch` (restarts DSH), `/engine` (replaces the DSH engine), `/update` (replaces the whole suite) and `/catalogue/refresh`. All five go through `corpsJson`. The boot beacon stays at the Origin alone (see the exceptions) |
| `kybernos-workers` | (L3-15) `/install` (starts « curl … \| bash » or `npm install -g` for up to fifteen minutes), `/activate` (mounts a package in `cordis.patch.yml`), `/policy` (rewrites that patch) and `/check` (runs the agents' binaries). All four go through `corpsJson`. The README no longer says « it does not check DSH's session cookie » |
| `kybernos-servers` | (L3-16) `/add`, `/switch`, `/rename`, `/remove` and `/check`: a server is an address, and the addresses in its profile are where the account token and the model traffic go; `check` makes this computer call any address. `session: true` on the five rows of `ROUTES`. The host's own loopback call to `/kybernos-cloud/server/apply` is a caller of the cloud bundle's row (see the exceptions) |
| `kybernos-skills` | (L3-17) the 28 POSTs of the Skills page, from the one `POST` wrapper of `index.js`: `covers/make` and `covers/auto` (they spend the DeepInfra key), `install` and `team/install` (they download and write a skill), `index-source/set` (it points Discover at another relay), `create`, `toggle`, `featured/toggle`, `skill/duplicate`, `skill/delete`, `skill/reveal`, `team/pack`, the `learned/*` family and `scout/*`. `skill/read` asks for the cookie too and is a phone read (below) |
| `kybernos-search` | (L3-09) `query` (it returns the text of the chats, the automations' prompts, the lessons and the agents: a **read**, behind the cookie as « The reads » below asks), `start` and `reindex` (they read every journal). The three go through the one `post` wrapper. `query` is a phone read |
| `kybernos-websearch` | (L3-20) `/key` (stores or clears a search key), `/settings` (the address every search is sent to), `/test` (this computer calls the engine's address) and `/seam`. The state (a GET) stays open behind the Host fence |
| `kybernos-free-llms` | (L3-21) `/enable`, `/disable` and `/auto-enable`: they write the `opencode-free` provider into DSH's settings, so what the person types leaves for opencode.ai. The engine's gateway routes keep the « not from another page » rule (below) |
| `kybernos-sessions` | (L3-18) the thirteen POSTs: the git and gh actions `isolate`, `commit`, `close-check`, `close`, `reclaim`, `push`, `fetch`, `sync`, `pr` (a push publishes, `pr` with `merge` merges as the person), `settings` and `categories` (files the agents read) and the Study-model calls `brain/health` and `decision`. `scripts/dsh-relance.mjs` signs its own cookie for `categories`. `/commit` also runs git with `GIT_LITERAL_PATHSPECS=1`, so a path that begins with `:` is a file name and not pathspec magic |

Every one of them is called by a page, so the browser sends the Origin and the cookie itself (`scripts/check-bundle-guards-live.mjs` plays the 65 routes of the eight bundles of fix 7 from a local program and
from the signed-in page, and clicks the Suite, Workers, Servers, Web search, Learned skills, Skills install and Search everywhere pages, reading the status the browser got for each request and the
Origin and cookie it put on the wire; `scripts/check-write-guard-live.mjs` clicks the Auto
Routing, Memory options and Cloud computers pages in a real GUI and reads what the browser got back). The phone link (`kybernos-mobile`) replays a phone's
requests with `Origin` and the machine's cookie, so a **read** passes; a **write** carries the `x-kybernos-tunnel` marker and is refused (above). What a phone's page asks of these
routes is therefore refused (403 `refused_on_phone`): pinning a chat, changing the layout or the team space, the Run button of a code block, a message to another session. The reads a page sends
as a POST are the two of the table above. The engine's own `/api` calls (the chat itself) are not concerned.
Turning that refusal into a list of writes the phone may make (decision DL-11 of the 2026-10-25 recette) is not done: it needs the phone page's calls measured on a real phone first.

## What stays open, and why

- **A documented caller that is not a browser.** `/kybernos-auto/router` and `/report`: `cli/auto-router.mjs`, which the agent runs, sends no Origin and has no
  session. `/kybernos-cloud/turn*`: the computer's own runner
  (strict Origin only, as before). **`/kybernos-cloud/server/apply`** (A-16): it is a real write a page also makes (the servers page), but
  `packages/kybernos-servers/host.mjs` calls it over loopback with this listener's `Origin` and **no cookie** when it applies the active server, so it keeps
  `strict` (a bare program with no header is now refused, where it used to pass) and the loopback call must be widened to the cookie before it can join the
  full rule. A foreign Origin is still refused on all of them.
- **`/kybernos-cloud/computer/claimed` (2026-10-25).** Its caller is the claim step of the cloud computer's image (`services/computer-image/claimer.mjs`), which posts to loopback
  with the Origin and no browser session; the request carries nothing and the identity is read from the volume. It says so in `noSession` in the ROUTES table, like the turn routes.
- **The widget's two POSTs, `/kybernos/widget/api/config` and `/widget/api/reply` (left at the strict Origin, 2026-10-25).** They sit on the embeddable widget's own surface (`widget/api/*`: the
  public config read, the visitor's message, account and history-delete are public by design, with their own fences) and share its files; the owner's page posts the widget settings to the first, and
  nothing in this repository calls the second. They are a different caller class from the owner's pages, so they were not moved in the same change: a local program that sends the Origin can still
  overwrite the widget settings or append a reply, as the agent, to a visitor's conversation. They are the next candidates, with the widget's callers read first.
- **`/kybernos/art-load` and `/art-previews`** change with the file-serving branch (`fix/file-serving`: their path confinement and file types), so they are left for it.
- **Four spending routes of `kybernos-plugin` (recette L3-19, 2026-10-25): `/kybernos/voice/transcribe`, `/models/audio/listen`, `/models/audio/probe` and `/tts/speak`.** They are
  called by pages (which have the cookie) **and** by `kybernos-call`: its Python worker (`agent/call_stt.py`, `agent/call_voice.py`) and its health check (`call-health.mjs`) post to
  them over loopback with an Origin and no cookie. Guarding them now would take away every call's ears and voice, so they stay at the strict Origin, and a local program that
  sends the Origin can still spend the owner's speech or transcription key through them. They join the rule when the call host hands its worker (and its health check) a credential;
  `packages/kybernos-plugin/test-write-guard.mjs` lists them with their caller and fails the day one is converted without the call side.
- **`/kybernos/slash/entries` (POST): CLOSED, and the skill moved off the route (A-16, 21/10).** It was written here as "the
  `slash-msgaction-creator` skill writes through it", but two **pages** write through it too — `packages/kybernos-slash/client.js` (the entry editor's
  add / delete / restore) and `packages/kybernos-plugin/client.js` (the startup upsert of the `/widget` entry, `credentials: 'same-origin'`). So the route
  had a browser caller *and* an agent caller without a session, and neither a plain conversion nor a documented exception was honest. Both halves are now
  separated, which is the only shape that holds: **the route takes the cookie** (its two page callers send it themselves, same-origin fetch), and **the
  agent writes through a host tool**, `enregistrer_entree` (`packages/kybernos-slash/tool.mjs`), registered on the `tools` service — in process, so there
  is nothing on the wire to authenticate and no second credential to leak. A route that accepted "a cookie, or no Origin at all" would be bypassed by
  omitting a header. The skill is shipped by the bundle and seeded (`packages/kybernos-slash/skills/slash-msgaction-creator/SKILL.md`), so the instruction
  follows the code instead of living on one machine. Measured, not read: `node scripts/audit-routes.mjs --table` shows `POST:cookie`.
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
- **The boot beacon `POST /kybernos-hub/beacon` (2026-10-25).** It is the crash detector of the hub: the page tells the host that a GUI loaded, stayed up, or showed DSH's « Failed to load
  plugins » screen. A detector that needs the session it exists to survive goes blind exactly when it matters (a session that cannot be judged would count every boot as failed), and the
  worst a forged verdict does is show the « safe mode is recommended » banner: safe mode itself is only turned on by the person, with the lifecycle robot. It keeps the strict Origin.
  The five other POSTs of the hub ask for the cookie.
- **Where the decided exceptions live (2026-10-25).** The list is in `scripts/route-guard-exceptions.mjs`, in two parts. `EXCEPTIONS` are decisions, each with the caller that cannot
  send the cookie or the reason the route is public: this section is their prose. `QUEUED` are debts, not decisions: routes that should take the cookie and have not, each with who
  converts it. `node scripts/audit-routes.mjs --check` exits 1 on a write route that an Origin alone lets through and that is in neither list, and on an entry that matches no such route
  any more (a stale entry would hide the day the route is weakened again); `scripts/test-route-guards.mjs` runs it in CI and, on the real table, weakens each of the 65 routes of
  the eight bundles converted in fix 7 in turn and checks that the verdict names exactly that route.

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

The `origin` column is the one A-16 measured: 43 write routes before this round, **3 now**; and the routes that answer every method alike fell from **5 to 3** at
the `origin` level (the two `kybernos-auto` ones now answer their write methods at the `strict` level). The three write routes left are the documented
non-browser callers above — and each of them genuinely has no session to offer:

| Bundle | Routes left at `origin` | Caller that keeps them there |
|---|---|---|
| `kybernos-auto` | `/report`, `/router` (POST) | `cli/auto-router.mjs`, run by the agent: no Origin, no session (documented above) |
| `kybernos-free-llms` | `/v1/chat/completions` (POST; its `/v1/models`, `/status` and `/health` are the every-method rows) | DSH's engine: no Origin, no cookie (documented above) |

`kybernos-slash` `/entries` (POST) has left this table: it is `POST:cookie` now, and the agent's path is the `enregistrer_entree` tool (above).

That sentence stood here: « every other write route is under the rule ». It was not true. Measured on 2026-10-25 (recette), 151 write routes of 19 bundles were still at the Origin alone
(145 at `strict`, 3 at `origin`, 3 at `open`), and nothing failed. After fix 7 (the eight bundles above) the table says 80 write routes at `strict`, 3 at `origin`, 3 at `open` and 207 under the cookie, and
`node scripts/audit-routes.mjs --check` writes down every one of the 146 route-methods an Origin alone still lets through (an every-method read counts once per write method): 76 decided
(`EXCEPTIONS`) and 70 queued (`QUEUED`: the cloud and core bundles of fix/cookie-guards, `kybernos-call` of fix 6, Kaby customisation, usage and multi-device of L3-29, and the dashboards, theme,
maintenance and flow routes that no finding names). The queued list must only shrink. No route that used to answer a write fails for its real caller: the bundle harnesses (`test-cloud-host.mjs`,
`test-account-state.mjs`, `test-unplug-host.mjs`, `test-write-guard.mjs` of each bundle) call the converted routes the way the page does — the right Origin
**and** the signed cookie — and the live checks that stay green drive the real pages. The six bundles converted last (modeles-locaux, modeleur, motion, bricks,
slides, slash) each carry their own copy of `session-guard.mjs` and a `test-write-guard.mjs` that proves the four refusals and the real pair; motion and slides also
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

Done since (2026-10-25, L3-09): `POST /kybernos-search/query` (Search everywhere: the text of every chat, 8,000 characters of a message with its title and folder, the prompts of the
automations, the lessons and the agents) is behind the cookie, with `start` and `reindex`. It is a read that took a POST; a phone may make it (above). A shell cannot reach it any more:
`scripts/test-team-memory-cut.mjs` already refuses `curl … /kybernos-search/query` in a team space, and the route now refuses it without the session as well.

Proposal: the session cookie on the chat-content group first (`search-content`, `load`, `runs`, `runs-index`, `calls`, `calls-index`, `insight`, `doc-raw`,
`quality-*`), then on the paths group. Two things to settle before: `kybernos-dashboards` fetches `/kybernos/load`, `/runs-index` and `/kybernos-skills/skills` from its page
(fine: the browser sends the cookie), but `kybernos-call` reads `/kybernos/voice/config` and `/voice-sample-audio` from its **host** over loopback with no cookie, so those two
stay as they are or the call host learns to send the cookie; and `/kybernos/onboarding` is read by `scripts/sandbox/setup.sh`.
