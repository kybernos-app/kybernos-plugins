# The origin rule of the host routes

DSH serves a plugin's routes **before** its own login (measured on `0.2.0-rc.2`: `/` answers 401, `/kybernos-hub/state` answers 200), and an
`Origin` header is forgeable by any local program or any other account on the machine. So a route that spends the person's money, deletes their
data, installs software or stores a key cannot rely on an Origin check. Decision D3 of the pre-production audit (2026-10-16), **narrow**: the
signed DSH session cookie, on top of a strict same-origin request, only on the write routes the audit names; every other route keeps the rule of
its bundle, and a route with a caller that is not a browser stays open and says why in a comment.

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

## What is under the rule (the origin-rule audit, A6-22)

| Bundle | Routes |
|---|---|
| `kybernos-composio` | every write: the key (save, delete), the connectors (save, delete, **test**: it starts the connector's command), their command folders, the accounts, the provider choice, the API connectors |
| `kybernos-memory` | the nine POST routes: lessons add, update, delete, the tidy-up, the switches |
| `kybernos-auto` | `/session`, `/settings`, `/probe` (a probe spends tokens) |
| `kybernos-modeles-locaux` | `/installer` (`brew install ollama`, `ollama pull`), `/annuler` |
| `kybernos-computers` | the nine POST routes: the E2B key, start, exec, write, stop, pause, resume, the environment switch (they run on the person's key and bill) |
| `kybernos-cloud` | the five deletes: `memory/delete`, `members/remove`, `team/lessons/delete`, `team/skills/delete`, `connections/delete` |
| `kybernos-miniapps` | `/install` (writes a native app and launches it), `/uninstall` |

Every one of them is called by a page, so the browser sends the Origin and the cookie itself (`scripts/check-write-guard-live.mjs` clicks the Auto
Routing, Memory options and Cloud computers pages in a real GUI and reads what the browser got back). The phone link (`kybernos-mobile`) replays a phone's
requests with `Origin` and the machine's cookie, so it passes too.

## What stays open, and why

- **A documented caller that is not a browser.** `/kybernos-auto/router` and `/report`: `cli/auto-router.mjs`, which the agent runs, sends no Origin and has no
  session. `/kybernos/slash/entries` (POST): the `slash-msgaction-creator` skill writes through it. A foreign Origin is still refused on all three.
  `/kybernos-cloud/turn*`: the computer's own runner (strict Origin only, as before).
- **The free-models gateway** (`/free-llms/v1/chat/completions`, `/v1/models`, `/status`, `/health`, A6-04). Its caller is DSH's engine: no Origin, no cookie, no
  browser header. It cannot ask for a session, so it refuses what a *browser* marks as another site: a foreign `Origin`, or `Sec-Fetch-Site` other than
  `same-origin` / `none`. A page the person merely visits can no longer make their machine call opencode.ai. (A browser too old to send `Sec-Fetch-Site` looks like
  the engine for a no-cors GET: only `/health` and `/status` can be reached that way, and DNS rebinding is stopped by the Host fence.)
- **Public by design:** `/kybernos/widget/api/*` and `/kybernos/hooks` (a website's widget and the webhook receiver; their own secret is their fence).
- **Not named by the audit, so unchanged (D3):** the other writes of `kybernos-cloud` (memory add / update / index / settings / tidy-up, team lessons and skills
  add / review / retire, shares, members invite, marketplace install, space, artifacts and chats push, `connections/link`, `disconnect`, `server/apply`, `start`,
  `poll`, `refresh`, `models/sync`), `kybernos-models` (annotations, journal, scores), `kybernos-motion` (export, frame), `kybernos-modeleur` and
  `kybernos-bricks` and `kybernos-slides` (push), `kybernos-modeles-locaux` (`/decouvrir`, the catalogue refresh). All have a page as their caller (the table says
  which), so they are the next candidates; each keeps the same-origin rule of its bundle (a foreign page is refused, a local program with no header is not).

`node scripts/audit-routes.mjs` is the evidence, measured and not claimed: it mounts every bundle's routes in-process under Node's permission model (no spawn, no
network, writes only in a throw-away home) and sends each route and method four requests (foreign Origin; no header; right Origin; right Origin and the signed
cookie). `--table` prints one line per route, `--json` the raw rows, `--root DIR` judges another checkout (a `git archive` of an earlier commit gives the "before").
Measured on 2026-10-16, 384 routes of 31 bundles, 249 of them answering a write method:

| Write routes | Before | Now |
|---|---|---|
| strict same-origin **and** the session cookie | 3 | 40 |
| strict same-origin (an Origin or Referer is required, a local program can send one) | 139 | 139 |
| a foreign page is refused, a local program with no header is not | 86 | 53 |
| a page of any site can drive them | 18 | 14 |
| need a state the empty test home lacks (`kybernos-motion`) | 3 | 3 |

Of the 67 left at the last two levels: 4 have a documented non-browser caller (above), 4 are public by design, 14 answer every method alike and are reads
(the handler never looks at the method), 45 are the writes the audit does not name.

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
