# Servers page: specification (draft 1, 2026-10-19)

Status: **specification only, nothing built.** Why and what was found: `docs/dev/servers-page-study-2026-10-19.md`. The clickable mockup is
its visual part. This file is what gets built, in this order, and how it is proved.

## 0. Decisions taken

| # | Decision | By |
|---|---|---|
| D1 | The DSH-side licence is **removed**. A company server checks its own licence (`product: kybernos-server`, seats); DSH ignores licences. | owner, 2026-10-19 |
| D2 | **A test server is used exactly like a company server**: same contract, same code path, no flag, no « test » kind. | owner, 2026-10-19 |
| D3 | A user needs only **an address and their account on that server**. No licence, no API key in the default flow. | owner, 2026-10-19 |
| D4 | The page becomes a **satellite of the open repo** (`packages/kybernos-servers`), since nothing paid is left in it. | default, reversible |
| D5 | **Phase 1** = browser sign-in. **Phase 2** = « Other ways to sign in » (access key, email + password); the link is not rendered before. | default |
| D6 | The built-in server keeps the name « Kybernos Cloud » and the host `api.kybernos.app` (renaming the host signs every installed DSH out). | default |
| D7 | The Enterprise card renders « Talk to us » only when a contact address is configured. The address and the copy are the owner's. | open |

## 1. Goal and non-goals

**Goal.** A person adds a server in three gestures: paste the address their administrator gave, click « Add and sign in », confirm the code in
the browser. Same for Kybernos staging, a local server and a customer's own server. Adding, switching and removing replace today's hand-edited
`servers.json`. The page also carries a help card and the Enterprise text.

**Non-goals.** Renaming `api.kybernos.app`; changes to the Kybernos server in phase 1; creating an account from DSH (the server's own activation
page does it); managing a server (its console does); routing chat differently; any licence check in DSH.

## 2. Vocabulary

- **Server**: an address that serves the discovery document and the Kybernos API. **Built-in server**: Kybernos Cloud, id `kybernos-cloud`, named
  once in `BUILTIN_API`. **Registry**: `<DSH home>/kybernos/servers.json`. **Profile**: one entry of it. **Connection file**: the server's
  sign-in, `kybernos-cloud.json` for the built-in server and `kybernos-cloud-<id>.json` for the others (0600). **Active server**: the one DSH talks
  to; exactly one.

## 3. What a server must be (the company-server contract, version 1)

Everything below **already exists** on the Kybernos server; the page asks nothing new of it in phase 1.

1. **Discovery.** `GET <address>/.well-known/kybernos-server.json`: 200 JSON, no redirect, under 64 KB, answered within 8 s.

   | Field | Rule |
   |---|---|
   | `schema` | `1`, required |
   | `api` | required; the address the account token goes to |
   | `name` | what the user sees; set by the server's `SERVER_NAME` (default « Kybernos ») |
   | `version`, `dsh_min` | optional; a server needing a newer DSH is refused with a sentence |
   | `web`, `console` | optional; default to the server's own host |
   | `services.llm` | a URL, absent (same host as `api`) or `false` (no Kybernos models) |
   | `services.connections` | a URL **on the same origin as `api`**, or `false`; absent = not offered |

   Source of truth: `src/modules/platform/discovery.ts` (server) and `normalizeProfile` (`kybernos-cloud/server-profile.mjs`). https only, http
   for loopback only, no credentials, query or fragment in any address; a present-but-invalid field refuses the whole profile.
2. **Sign-in.** Device pairing: `POST /v1/device/start` returns a code and an activation address on the server (`/cloud/cli/activate`); the user
   approves it there with a recent strong authentication; DSH claims the token once with `POST /v1/device/poll`. DSH never sees a password.
3. **Models and chat.** `<api>/v1/models`, `<api>/v1/chat/completions` (or `services.llm`) with the device token.
4. **Who may have an account** is the server's business: registration open or closed (`403 registration_closed`), seats and the server licence
   (a lapsed licence refuses **new** accounts and locks nobody out). DSH only reports that the pairing did not finish (§ 4.8).
5. **What the administrator sets for a good experience**: `SERVER_NAME` (the name in DSH), the public address, registration. **Every test server
   sets its own `SERVER_NAME`** (« Kybernos Staging », « Kybernos Local »), because today they all answer « Kybernos ».

Gaps found: DSH's `discover()` drops `services.connections` (a company server with connected apps loses the mode); every test server is called
« Kybernos ». Both are fixed in phase 1 (§ 4.4, § 7).

## 4. DSH behaviour (phase 1)

### 4.1 Where it lives
- Settings › **Devices** › **Servers** (slot `settings.section`, id `kybernos-servers`; group `devices` in the Settings nav; search entry
  « Add a server », keywords **without** « licence »). Zero engine patch; `apply()` guarded; no `remote.*` beyond what the routes need.
- Host routes: `GET /kybernos-servers/status`, `POST /kybernos-servers/{check,add,switch,remove,rename}`. Every POST is same-origin strict, and **every route is behind the Host fence** (`kbFenced`, `scripts/test-route-hosts.mjs`: a page that rebinds its name to this machine is refused, reads included); both guards accept the authorities declared with `--trusted-host` on a hosted instance (`kbTrusted`, `scripts/test-trusted-guards.mjs`).
  The open half stays the judge of a profile (`GET /kybernos-cloud/server`) and applies a switch (`POST /kybernos-cloud/server/apply`).

### 4.2 The list
One row per server: tile (initial), name, one line (« Managed by Kybernos » for the built-in server, the host for the others), tags **Active** and
**Signed in** / **Not signed in**, actions **Switch to this server** (not on the active row), **Sign in** (active and not signed in), **Details**,
**Remove** (never on the built-in server). **Details** shows API, Web, Console, LLM addresses and a **Rename** field. No kind, no « test » tag.
A neutral banner above the list while the active server is not the built-in one, with « Back to Kybernos Cloud » (always available).

### 4.3 Add: a state machine
`empty` → (paste, Enter or leaving the field; **never while typing**) → `checking` → `found` | `error` → `adding` → `signing-in` → `done` | `later`.

- **Input**: a bare host becomes https, except a bare loopback host (`localhost:8791`) which becomes http (a local server rarely has a certificate); `host:port` works; a full URL keeps its scheme and path; http only for loopback; at most 300 characters.
- **found**: the server's name, its host, « Your sign-in and its token will only go to <host> »; **See the addresses** lists API, Web, Console, LLM
  (shown expanded whenever one of them is on another host than the typed one).
- **error**: one sentence, from this table (French and English, never a raw code):

  | Cause | Sentence (EN) |
  |---|---|
  | insecure address | Use an https address. |
  | no answer / timeout | The server does not answer. |
  | redirect | The server redirects elsewhere: type its final address. |
  | no profile / unreadable / no `api` | This server does not publish a Kybernos profile. |
  | `dsh_min` above this DSH | This server needs a newer version of DSH. |
  | profile refused by the open half | This server's profile is refused (invalid address). |
  | already in the list | This server is already in your list. [Switch to it] |
  | registry unreadable | The servers file is unreadable: fix it by hand, nothing was changed. |

- **adding**: writes the profile (0600, atomic), asks the open half whether it accepts it and **undoes the write if not**; then switches to it
  (`apply`) without a second dialog; the one-line note says what changes (account, models, team) and what stays (chats, files, memory).
- The primary button is « Add and sign in »; it is disabled until `found`.

### 4.4 Names, ids, duplicates
- Name = what the user typed, else the published name. If that name is « Kybernos » or already in the list: `<name> · <host>`. Renaming later in Details.
- Id = slug of the **final** name (the one the person sees, not the name every server publishes), ≤ 40 characters, unique (`-2`, `-3`…); `kybernos-cloud` is reserved. It ends up in a file name (`kybernos-cloud-<id>.json`).
- **No duplicate `api`**: the check compares the normalised `api` with the built-in server and every entry. The hand-written `kybernos-prod` entry of
  today (same `api` as the built-in server) is **dropped at read time** by the open half and listed in `rejected` as `duplicate_builtin`; if it
  was the active one, the built-in server becomes active. **No token is ever moved or deleted by this**; its leftover connection file is ignored.
- The discovered profile keeps `services.connections` when it is a URL on the same origin as `api` (the open half re-validates it).

### 4.5 Switch and remove
- **Switch** from a row: the dialog lists what changes and what stays (as today), then `apply`. A server the DSH is not signed in to says so and the
  **Sign in** step follows.
- **Remove**: forgets the sign-in **on this device** (deletes that server's connection file) and the entry; nothing is deleted on the server. If it was
  active, DSH goes back to the built-in server first (the previous server's model route is cleaned by the open half, unchanged).

### 4.6 Sign-in dialog
Shows the code, an « Open the activation page » button, « Waiting for your approval… ». Polls `POST /kybernos-cloud/poll` every 3 s. **Later**
keeps the server added and not signed in (the row then offers **Sign in**). When the server's `expires_in` passes: « The code expired » and **Get a new code**.

### 4.7 Enterprise card
**Always shown, under the list** (it is the shop window for the server offer: a person who has added a server may still be the one who buys). Eyebrow « Enterprise »; title « Run Kybernos on your own server »; lead; four
points; buttons « Talk to us » (**rendered only when a contact address is configured**, so there is never a dead button) and « My company already has a
server » (opens the add dialog). The card makes **no network call**. The four points must stay true (checked against the server's documented features):

| Point | Backed by |
|---|---|
| Your own server | the on-premises build and its licence module (`src/modules/licence`) |
| Your skills | team skills and lessons from the server's own catalogue (`docs/dev/team-skills-contract.md`) |
| Your own API keys (BYOK) | workspace providers (BYOK) and `byok/` models in the catalogue |
| Control | roles, required second factor, usage limits, audit log |

### 4.8 When the pairing does not finish
The server may refuse a new account (registration closed, seats, lapsed licence): that message appears on **its own** activation page. DSH shows, after
the code expires: « The code expired. If you cannot create an account on this server, ask its administrator. » It never mentions a licence.

### 4.9 Help
`packages/kybernos-servers/help.json` (what / steps / where / good / url, French and English, validated by `build-catalog`), shown through
`window.__KB_HELP__.Help({ id: 'kybernos-servers' })` behind the usual guard. The text: what a server is; add (paste, « Add and sign in », confirm the
code); switch (what changes and stays); remove (forgets the sign-in here); « on a company server, connected apps and the phone link depend on its
configuration »; « a test or development server can be reset ».

### 4.10 Languages and accessibility
Every string goes through `kt(fr, en)`; hooks are `data-kb` / `data-act`. Dialogs have `role="dialog"`, `aria-modal`, Escape closes, focus lands on the
address field, the added row is announced (`role="status"`). Colours come from DSH tokens only.

## 5. Phase 2 (not built, not rendered)
- **Access key**: a new connection kind in the open half (chat models only: no account, team or memory; the Cloud card says « Models only »). Needs the
  key stored in the connection file (0600) and the model route fed with it.
- **Email + password**: the server requires a recent strong authentication to approve a device and has no route that turns a password into a token.
  Not buildable in DSH without a **server ADR** (a route, or an explicit decision that DSH must never carry a password). Until then it does not exist.

## 6. Security and privacy
The token goes only to the profile's addresses, shown before adding. No secret in the registry. Every POST is same-origin strict (plugin routes are
served before DSH's own auth). The discovery fetch: no redirect, 64 KB, 8 s, https or loopback http; **private addresses are allowed on purpose**
(on-premises servers live on internal networks) and DSH is the user's own program, not a shared server. No password is handled in phase 1. The
Enterprise card sends nothing. Removing a server deletes its connection file.

## 7. What is removed, what stays
**Removed** (in the private repo, after the open satellite is live): `licence.mjs`, `test-licence.mjs`, `scripts/issue-licence.mjs`, the
`/kybernos-servers/licence` route, `mayAdd` / `maySwitchTo`, the licence card and every `licence_*` sentence, the reading of `licence-servers.json`.
**Stays**: the server's own licence module and **the licence signing key** (kept outside every repository), because the server's licence uses
the same key chain (`k1`); only the `kybernos-servers` product licences are retired. A user's leftover `licence-servers.json` is ignored, not deleted.

## 8. Proof: the test server is a company server
Three levels, none of them touches the maintainer's real DSH (its `servers.json` is on the local server for the Teams end-to-end run).

1. **Hermetic** (`packages/kybernos-servers/test-*.mjs`, run by CI): fake servers in-process, like `test-server-switch.mjs`. One fake server per
   behaviour: valid, no profile, redirect, unreachable, slow, too big, `dsh_min` too high, `services.connections` same-origin / other origin, same
   `api` as the built-in server, never-finishing pairing.
2. **Sandbox GUI** (`scripts/sandbox/*`: a second DSH on its own port, own HOME and DSH_HOME) against the **local replica of the Kybernos server**
   started with its own `SERVER_NAME`, used **as a company server**: `scripts/check-servers-live.mjs` (a `check-*`, never a `test-*`).
3. **One real HTTPS test server** (dev or staging), read-only first: add, sign in with a test account, switch, list models, switch back, remove.

| ID | Case | Level |
|---|---|---|
| SRV-01 | Paste a bare host, `host:port`, a full URL: all become the right address; http refused except loopback | 1 |
| SRV-02 | Each error of § 4.3 gives its sentence in French and English, never a raw code | 1 |
| SRV-03 | Check never runs while typing; runs on paste, Enter, leaving the field | 1, 2 |
| SRV-04 | `services.connections` is kept when same-origin, dropped otherwise | 1 |
| SRV-05 | Two servers answering « Kybernos » get distinct names; ids stay unique | 1 |
| SRV-06 | A profile whose `api` equals the built-in server's is refused; the hand-written `kybernos-prod` entry is dropped at read time, no token touched | 1 |
| SRV-07 | The open half refusing a profile undoes the write (registry byte for byte as before) | 1 |
| SRV-08 | An unreadable registry is never overwritten | 1 |
| SRV-09 | Add → switch → remove: the model route and credential of the left server are cleaned (existing test extended) | 1 |
| SRV-10 | Remove deletes that server's connection file and leaves the others | 1 |
| SRV-11 | A POST with no origin or another origin → 403; ids with a slash or upper case → refused | 1 |
| SRV-12 | The code path has **no** licence: no `licence` route, no `licence_*` sentence, no `licence-servers.json` read (grep test, mutation-tested) | 1 |
| SRV-13 | Enterprise card: always rendered under the list (one server or several); no « Talk to us » without an address; no network call | 1 |
| SRV-14 | Help card present in both languages and valid for `build-catalog` | 1 |
| SRV-15 | Sandbox: paste the replica's address → name shown → « Add and sign in » → code approved → active and signed in, three gestures | 2 |
| SRV-16 | Sandbox: the same server added twice by two spellings of its address → once | 2 |
| SRV-17 | Sandbox: remove the active server → back on Kybernos Cloud, no stale token | 2 |
| SRV-18 | Sandbox: banner shown off the built-in server, hidden on it | 2 |
| SRV-19 | Sandbox: nothing wider than the column, no `undefined`, both themes, phone width | 2 |
| SRV-20 | Real test server: add, sign in, list models, switch back, remove | 3 |
| SRV-21 | **Measure whether switching still needs a DSH reload** to refresh the model list; the toast says what is true | 2, 3 |

Gate before any push: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`, plus
`node scripts/test-layout.mjs`, `node scripts/build-catalog.mjs --check` and every `packages/*/test*.mjs` (CI runs them all).

## 9. Build plan
Work from `dev`, one worktree per PR, in the **open repo** unless said. The checklist is the repo's `new-kybernos-plugin` skill.

| PR | Content | Rules |
|---|---|---|
| 1. open: `kybernos-servers` | the satellite: client, host routes, pure `discovery.mjs` (keeps `connections`), dedupe, rename, no licence; the five registrations (`lifecycle-packages.json`, `satellites.json`, `build-catalog.mjs` FICHE / TITRES / GLYPHES, `garde.mjs`, README); `help.json`; tests SRV-01…14; `check-servers-live.mjs` | zero engine patch; `apply()` guarded; the package is **not** in anybody's profile yet |
| 2. open: `kybernos-cloud` (**built**, branch `feat/servers-cloud-duplicate`) | drop `duplicate_builtin` entries in `readRegistry`; the Settings search keywords (`docs/dev/servers.md` was already rewritten in PR 1) | extends `test-server-profile` and `test-server-switch` |
| 3. private: retire the module | delete the package and the licence tooling (§ 7); `AGENTS.md` line | **dead-code rider**: the whole licence stack goes |
| Owner, not me | in the real profile: remove the private link of `@local/kybernos-servers`, activate the open satellite, restart `dsh web` (host routes) | never done while the Teams end-to-end run is open; same package name, so the old link must go first |

Rollback: PR 1 and 2 change nothing in a running DSH until the owner activates; relinking the private package restores today's page.

## 10. Open points and not verified
- **Owner**: the contact address and the final copy of the Enterprise card; whether phase 2 is wanted and in which order.
- **Not verified**: nothing here was run. The Enterprise claims match the server's documented features, not a live check. That a switch no longer needs a
  reload is unmeasured (SRV-21). That `services.connections` kept at add time makes the connections mode work on a company server is unproven.
- **To prove at build time**: `services.gateway` and the old-stack opt-in block of `docs/dev/servers.md` are dead-code candidates (rule 3); grep and
  tests decide, not this document.

## 11. PR 1 as built (2026-10-19, branch `feat/servers-satellite`, nothing committed)

- **Package** `packages/kybernos-servers`: `index.js` + `host.mjs` (routes, guards), `discovery.mjs`, `registry.mjs` (pure), `client.js` (the page),
  `help.json`, `README.md`, `test-discovery.mjs`, `test-registry.mjs`, `test-host.mjs` (real handlers + the real cloud half + 10 fake servers; 5 mutations
  of the protections are caught), `test-client.mjs` (source contract always, render half when React is found), and `scripts/check-servers-live.mjs`.
- **Registration** beyond the five places of the plugin skill, found by running every CI test: `scripts/i18n-french-allow.json` (strict, `[]`),
  `scripts/test-help.mjs` (the help site has no Servers article yet: the list of modules without one is five), a **new glyph** `server` in the hub's
  table (the layout test wants a glyph of its own per module), and the catalogue regenerated. The French copy speaks « tu » and the helper falls
  back to English like the other strict bundles; the Host fence and `kbTrusted` are the repo's guard conventions.
- **Not activated anywhere**: `satellites.json` has no `defaut`, so no install picks it up by itself. The owner's profile still links the private package of the same name.
- **Found live, fixed**: pressing « Add and sign in » blurred the field, which re-checked an address already checked and made the click vanish
  (`checkedFor`); a 100 % wide input stuck out of its dialog (`box-sizing`). Both have a source assertion in `test-client.mjs`.
- **Still red on `dev`, not touched** (five tests fail without this change): `kybernos-memory/test-client`, `kybernos-sessions/test-prefix`,
  `test-consistency-guards`, `test-display-rules`, and the French-literals check on `kybernos-plugin/client.js`.

## 12. PR 2 as built (2026-10-19, branch `feat/servers-cloud-duplicate`, on top of PR 1, nothing committed)

- `kybernos-cloud/server-profile.mjs` `readRegistry`: an entry whose `api` equals the built-in server's is dropped and listed as
  `duplicate_builtin` (after the validity checks, so an invalid entry keeps its more useful reason); an `active` that named it becomes the built-in
  server. No file is read, moved or deleted by this. A different path, port or host is another server and is kept.
- `test-server-profile.mjs`: 12 new checks (the « production » entry, three spellings, near misses, invalid first, `active` untouched when it names a
  kept entry). `test-server-switch.mjs`: the route answers the built-in server as active with no error, the copy is not listed, and both sign-ins on
  disk are byte for byte what they were. Three mutations of the rule are caught by the two tests.
- Settings search: the « Servers » row no longer carries « licence » and gains « adresse / address / ajouter / connecter » (`kybernos-plugin/client.js`).
- Not done: the tokens of the copy are not merged into the built-in server's file (a person signed in only through the copy signs in once on the
  built-in server); that is deliberate, a token is never moved.
