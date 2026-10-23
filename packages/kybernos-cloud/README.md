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
| Pairing | the device code, “Open activation page” (which also copies the code: the server's page shows nothing of it and asks for it to be pasted or typed, on purpose, and the link already carries the device and the code, which the page reads and removes from its address), “Copy code”, “Cancel request” |
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

## When the server stops knowing this device (and other states of the account)

- **A refused token ends the connection at once.** A device revoked from the account page, or a server on a new database, answers 401 (its own `{ error }` envelope) to every
  call the host makes with the token. The first such answer, on any route, makes the host ask `/v1/workspaces` once more (one check at a time; a check that finds the token
  fine is not repeated for 5 s: a route's own 401 signs nobody out). If that is refused too, the imported models leave and the state file goes, **and `kybernos-cloud.json.ended`
  stays beside it** (the time, never the token). `/status` then answers `{ connected: false, status: 'revoked', ended: { at } }`, and `/console/link` and `/quota` answer
  `{ status: 'revoked', error: 'session_ended' }`, so the footer says « Sign in again » and why within seconds (no 5-minute wait). A new pairing, a claim or a sign-out clears the marker.
- **A pairing is asked about by whoever shows it.** The footer polls `/poll` while a pairing is under way and so does the open card; the host makes one call of simultaneous polls
  (the server hands the token to the first asker), and a refusal or an expiry reaches both.
- **A team with no plan** answers `/quota` with `no_plan: true` (the plan route says `plan: null`): the notice and the plan slot say « No plan » and offer the plan page. `POST
  /space/create` does not make such a team active: the answer carries `created: { id, name, plan_key, activated }` and the footer tells the person where they are.
- **Several spaces: the menu, the plan card, the wait on a switch, the cues** (plan « Équipes », steps 1, 2, 3 and 7; the pure rules are the `teams-menu` block of the client, played by
  `test-teams-menu.mjs`). Up to `INLINE_SPACES_MAX` (3: Personal + 2 teams) spaces the account menu lists them at its top (tile in the team's colour, name, « Admin · 6 members » or
  « you · plan », the usage percent and its bar, a check on the active one, « Create a team »); from four the top row stays « Switch team » and opens the full list next to the menu.
  The rows' usage and head counts come from `GET /spaces/summary` (read when the menu opens, kept 15 s: per space the budget windows as percents, a team's member count, the personal
  space's plan name; never an amount of money). The plan card follows the role: a team shows « Team » (its pool, the 30-day window) and « You » (the person's 5 hours and 7 days, plus any
  other window of theirs that is used up); an owner or admin also gets « Manage » (the web Team settings, through the console link) and, once the pool is used up, « Add credits »;
  a member gets neither; a personal space shows no allowance (no row in the card, no gauge on the footer card: it is the Kybernos plan's number, meaningless to a person on a key of their own, and the composer's chip from kybernos-usage shows it on a Kybernos model) and, on Free, « Upgrade ». The menu's blocks are Teams · Account (Account, Referral) · Appearance, Phone and channels, Settings · Links · Sign out, each pair separated by a rule. A window that has room says how long it is (« Last 7 days »); only a window that is used up
  says « Back in about 3 h » (the windows are rolling: the server gives `resets_at` only then). **A switch waits on DSH:** `POST /space/active` answers `route` (`written`, `current`,
  `none`, `not_written`, `failed`), and `POST /space/applied { workspace_id }` says whether the RUNNING model route (`settings.describe()`, not the file) names the space; the footer says
  « Switching… » until it does (at least 3.5 s when it cannot tell, at most 15 s), and a route that could not be rewritten is said at once (messages may still be billed to the previous
  team). **The composer's cues in a team space** (none in the personal one): a pill on memory in the team's colour, in the composer's dock and the new chat's options row (a pill on the
  working folder only when `state.space_folder` names one: the host names the team's folder, see « One working folder per team » below), « Message <Team>… » in the box (DSH's own placeholder node, put back when the person leaves
  the team; a disabled box keeps DSH's words, but DSH's plan hint and queue hint are replaced too: nothing on the page tells the placeholder's states apart) and « What is <Team> working on? » over a new chat (the core plugin reads `window.__KB_SPACE_CUE__`). The memory pill says « personal off » only when
  `PERSONAL_MEMORY_CUT` is `true` in the client: it is `false` until the memory work (`feat/teams-memory-cut`) lands, so the pill does not promise what is not true yet.

- **Joining a team with an invitation link** (plan « Équipes », step 4; the pure rules are the `join-link` block of the client, played by `test-join-link.mjs`; the host routes by
  `test-join-host.mjs`; the rendered dialog by `test-cloud-client.mjs`; the real page, the real host and a fake server by `scripts/check-join-live.mjs`). The row « Join with an
  invitation link » sits under « Create a team » in both lists of the account menu. It opens a dialog: the person pastes the link the server e-mails
  (`<server>/invitations/accept?token=…`) or just the token; the page reads it (the token may ride the query or the fragment; anything else is refused with a sentence, nothing is sent)
  and presses « Check »: `POST /invitation/preview` asks the ACTIVE server `POST /v1/invitations/preview` (public, no device token) and the card shows the team, who invited, the role and
  the address it was sent to; « Join the team » then calls `POST /invitation/accept` (`POST /v1/invitations/accept` with the device token: the account must own the invited address).
  **The token goes to the active server's own API and to no other address**: a pasted link is only a carrier (its host is read to say « this link comes from X; your active server
  is Y » on a refusal, never called), it travels in the body of a POST, never in an address, a log or an answer. `preview` is strict same-origin; `accept` also needs DSH's signed
  session (it makes the person a member). The server answers ONE 404 for an unknown, used, withdrawn, expired or someone else's invitation (`invitation_unusable`: one sentence names
  all of them), 409 `seat_limit` for a full team (`seat_limit`: the link stays valid, nothing is written), 429 (`rate_limited`) and a network failure (`unreachable`); anything else is
  `refused` and the dialog offers « Open in the browser »: the server's own page for the same invitation, on the ACTIVE server's web address. After an accepted invitation the host reads
  the list of teams again and the new team's plan (`joined: { id, name, role, plan_key }`) and does NOT activate it: the footer switches through the ordinary path (`space/active`, with
  the wait on the model route), except for a team that has no plan (`plan_key: 'none'`, as for a team the person just created): they stay where they are and are told.

- **One working folder per team** (plan « Équipes », step 6; the host half is `team-folder.mjs`, played by `test-team-folder.mjs` and `test-team-folder-host.mjs`; the client rules are the
  `team-folder` block, played by `test-team-folder-nav.mjs`; the rendered footer by `test-cloud-client.mjs`; the real DSH, its workspaces and a fake Kybernos by
  `scripts/check-team-folder-live.mjs`). A chat's working folder is fixed when the chat starts, so a team switch cannot move an open chat: it opens a NEW one in the team's folder.
  **The folder:** `<Documents>/Kybernos/<Team>` (the root kybernos-multi-device's private folders share: `scripts/test-team-folder-rule.mjs` keeps the two « where is Documents » rules
  equal; `KYBERNOS_DOCUMENTS_DIR` moves it for tests and the sandbox), made by the host when a team is switched to, created (with or without a plan: it is a place to work either way),
  joined, or found active with none (`POST /space/folder { workspace_id }`, asked once per team and page: a team joined before this existed). **The name is hostile input** (a team lead
  or a colleague wrote it): it is cut down to ONE segment (no separator, drive colon, wildcard, control or invisible character, `..`, leading or trailing dot; 60 characters; a name that
  leaves nothing or that Windows reserves becomes « Team <id> »), the folder is made as a direct child of the root with a `mkdir` that is NOT recursive, and a name already on the disk
  (another team's, the person's own, a file) is never taken over: the team gets « <Name> (<first 8 of its id>) ». **Where it is recorded:** `kybernos-cloud-folders.json` beside the
  state file (`{ <workspace id>: <path> }`), not in it: a sign-out wipes the state, and the team's folder must still be the team's at the next sign-in. Only a direct child of the root
  is followed or listed. The public state names the ACTIVE team's folder (`space_folder`: the composer's folder pill reads it) and every team's (`team_folders`), never the file. The page names a team,
  never a path. A disk that refuses (`not_allowed`, `mkdir_failed`) leaves the team without a folder, never without a switch. **The page** (DSH's own services, read with `ctx.get`):
  `workspaces.create({ path })` registers the folder as a DSH workspace (idempotent: a registered one is resolved) and answers its id, `uiWorkspace.startSession(id)` opens a new chat in
  it, once DSH runs the team's model route (the same wait as a switch). A switch back to Personal opens a new chat in the workspace the person was in before the team (the folder of the chat on
  screen at the moment of the switch, kept in this browser; else the first workspace that is no team's), never by inheritance: `startSession()` with no id would land in the workspace on
  screen, which is the team's. A team created with a plan, or joined, does the same; one created without a plan opens nothing. A DSH that is missing, or refuses, changes nothing.
  A chat already started keeps its folder (DSH's rule).
- **The active team follows the chat** (plan « Équipes », option 2; `chat-space.mjs`, the `follow-chat` block of `client.js`, tests `test-chat-space.mjs`, `test-chat-space-host.mjs`,
  `test-follow-chat.mjs`, live `scripts/check-follow-chat-live.mjs`). DSH has ONE model route per instance and its `x-kybernos-workspace` header names the ACTIVE team, so a chat is billed
  to whoever is active. The rule: **a chat in a team's folder bills that team, every other chat bills Personal** (Kaby's folder included); the team folders are the ones the host recorded
  (step 6). So the active team follows the chat the person is looking at, and personal memory follows the active team as before. **The page** reports the chat on screen (the main view's
  selection of `uiWorkspace`, the session's own `cwd` from `sessions`, else its workspace's path) with `POST /space/for-folder { path, session_id }` when it opens, when the page loads on
  it and every ten seconds; the host answers which space owns that folder (the team folder or anything under it, not a sibling such as `Acme-2`; symbolic links followed; a deleted folder
  placed by its deepest existing ancestor; case folded on macOS and Windows) and whether it is the active one, and the page switches through the ordinary path (`pickSpace`: « Switching… »,
  the route-applied wait) WITHOUT opening a chat. It acts when the chat on screen changes, never against a switch the person just made by hand: a choice by hand (a click, a team just created or joined) is told to the follower
  (`follower.chose()` from the first moment of the click to the end of the switch), and every chat on screen then, even one DSH has not listed yet (it lists the chat a switch opens about half
  a second later), is the person's to leave; a chat they open afterwards is followed, and a choice that failed hands the chats back. **The host is the safety net**: a turn of a
  chat the page reported in the last two minutes, claimed while the active space is not the chat's, writes the right space at once (the system prompt of that step is assembled right
  after the claim and reads it: the personal-memory cut) and the `agent/pre-step` listener holds the first model request until the switch (plan, folder, model route) is through, at most
  10 s. A switch can land between the claim and that request (a click or a script already on its way), so when the claim found the chat's team already active the team is decided again just before
  the first request. A chat the page never reported (an automation, Kaby's chat, a Telegram turn, a subagent) changes nothing and is billed to whichever team is active.
  **No switch under a running reply** (part B; `createTurnWatch` in `chat-space.mjs`, test `test-turn-guard-host.mjs`): a reply sends several requests and the model route is one per
  instance, so a switch while a reply runs bills it to two teams. The host REFUSES a switch while any reply is running (`space/active` answers `{ ok: false, error: 'turn_running',
  running: { count, since, space_id, space_name } }`, writes nothing and asks the server nothing), whoever asks: a click, the page following a chat, a script, a second window. A reply is
  counted from `agent/status` `running` (it comes before the claim and the first request) to `idle` or the chat's disposal, and the engine's own registry (`ctx.agents`, each agent's
  `status`) corrects the events: a missed `idle` cannot leave a reply stuck, a missed start is found at the next look. Past 30 minutes a reply no longer blocks (it FAILS OPEN on purpose:
  a person held for good by a wrong counter is worse than one long reply billed to two teams, which is what happened before the guard); a restart empties the table and the registry brings
  back what is really running. Choosing the space that is already active is not a switch; the claim-time switch does not count the claiming turn and does not happen at all while ANOTHER
  reply runs; a team created while a reply runs is created and listed but does not take over (`created.activated: false`, `created.busy`). `GET /space/busy` says whether a reply runs.
  **The page** tells the person, for a click, `A reply is still running in <Team>. Switching waits for it or stop it first.`; for a switch that follows a chat it shows, where the person
  types (the composer's pills), `This chat belongs to <Team>; <Active> stays active until the reply ends.` and makes the switch by itself when `space/busy` says no reply runs (polled every
  1.5 s; dropped when the person opens another chat). **The exposure that remains, said plainly:** while a switch is deferred a message typed in the chat now on screen is billed to the team
  still active (measured by `check-follow-chat-live.mjs`), and every turn nobody looks at is billed to whichever team is active: Kaby's own chat (a native DSH conversation on the same model
  route), a Telegram turn relayed to this computer (`/turn`), an automation, a subagent.
- **The failure row of a turn** (`conversation.chat.node`, key `turn-error`): the engine documents that a later entry for a key shadows the shipped one, so the plugin wraps the
  SHIPPED row (found in the slot's entries, registered at the lowest priority with the shipped entry's own locale). `no adapter registered for provider "kybernos"` (the cloud models
  are gone: the connection ended or was never made) and `QUOTA` on a team with no plan are drawn by the shipped row with a sentence and an action beside it (« Sign in again »,
  « Choose a plan »); every other failure is the shipped row, untouched.
- **The retry row of a turn** (`conversation.chat.node`, key `model-retry`, wrapped the same way): while the account server is down a chat showed only the engine's « Retrying model
  request (n/m) · 12s ». When the retry is of the `kybernos` route (the `provider` of the engine's `llm/retry` event), the attempt is waiting, and the host's `/quota` read answers
  `{ ok: false, error: 'injoignable', server: { name, host, can_switch } }` (neither of its two server reads got an answer; the footer reads it every two minutes anyway, the row reads it
  once per attempt), the engine's label is replaced by « The Kybernos server “X” (host) is not answering: DSH keeps retrying » (the count and the countdown are still the engine's), with
  « Switch server » beside it when the registry names another server. Another provider's retry, an attempt that started or was cancelled, a server that answers or refuses, a session
  the server ended, or a host that does not answer: the shipped row, untouched, and no read at all unless the first two hold.
- **A page of the account asked for by another plugin** (`window` event `kybernos-cloud:account`, `detail: { section }`, cancelable): the footer claims it (cancels it) when the account
  is connected and opens that page with the same console link as its menu entries (`section`, `open: true`, the active team); a request it does not claim (signed out, no footer) is left
  to the sender. The core plugin's gift card uses it for « Open the referral page » (and falls back to `<web>/account#referral`, which the app keeps through its own sign-in).

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

   Two more, measured on dev on 2026-10-19 (a test conversation wrote seven memories): the agent's words are no source
   of memory, and one request is not a preference. (3) After a **question**, or a message long enough to stand alone (over 80
   characters), only the person's words are submitted: « what do you know about me? » had made the capture write three
   memories it had just read back. The agent's question is kept as context only for a short reply (« yes, Paris »). (4) A
   `preference` or a `policy` is kept only when the person says it lasts (`always`, `from now on`, `by default`, `I prefer`,
   `toujours`, `désormais`, `je préfère`, `siempre`…, `isLasting`): « answer in Spanish » is about one answer. The extraction prompt says both too.
   (5) A fact **close to** a memory the account already holds is not rewritten (`nearKnown`: word overlap of 0.6, or 0.9 of the shorter one with at least five
   words, using the tidy-up's own comparison; a negation, or a number the other text does not have, makes it a different fact). The exact-text check of (2) did not see
   a reworded copy, and an automation's turns wrote ten of them each: replaying the 86 memories of the dev account in order, 27 are repeats (15 of the 31 written since the capture
   began). It is a guard, not a cleaner: what is already stored stays for the Memory tidy-up.
   (6) A refusal is a refusal: when the person refused a `memory_write` or a `lesson_write` in the turn (the gate of Kaby's own chat, or a cloud computer's), the capture of that
   turn does not run (`refusee`). Measured on the real DSH: the card was refused and the same fact appeared in the account a second later, written by the capture.

   The capture is *fail-open* by construction, hence **observable**: each
   exit writes a state (`hors_connexion`, `desactivee`, `sans_session`,
   `tour_trop_court`, `llm_indisponible`, `rien_a_retenir`, `deja_connu`, `refusee`, `ecrit`, `erreur`) that the route and the card display. Without
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

### Team space: the personal memory is cut

The whole picture of the teams feature (the rules, the files, the seams, the known limits, the tests) is in `docs/dev/teams.md`.

When the active space is a **team**, nothing personal reaches the model and nothing personal is written. This is not a setting; the one
door from personal to team is the explicit « Propose to team » action (below, « Team lessons »).

- **What a team space is** (`team-space.mjs`, `spaceKind`): the account is connected and the active space (`espaceActif`) is not a record that
  says `personal: true` (a required boolean of the server's Workspace). Only that exact value is personal: a missing list, an active space
  that is not in it, a record without the flag, a `personal` that is not a boolean, a model route (`state.models.workspace`) that still names
  another space than the active one (a failed catalogue import, a stale write: the chat is billed where the ROUTE says), and a state file that
  exists but cannot be read now (damaged, empty, caught half way by a write, bad rights) all count as a team. **Fail closed**: a wrong cut costs a memory that does not show
  up, a wrong keep would put a personal memory in front of a team conversation. Not connected (no state file): no teams exist, nothing changes.
- **What is cut**: the `kybernos:memory` block (it says `[KYBERNOS MEMORY OFF]` first, then the reason). The Kybernos proxy looks for its markers in the
  system/developer messages only, and a `context` block reaches the model as a user message, so the same marker also leads a real system **section**
  (`kybernos:memory-off`, empty outside a team space): that is what keeps the proxy from adding the person's account memory to a team request; `memory_write` and `memory_search` (one sentence that points to « Propose to team », nothing sent to the server); the end-of-turn
  capture (before any model call, and also for a turn that began in a team and ends after a switch back to personal; the memory pill reads « off in a team space »); the lowest door `createMemory` for what the model writes (the
  tool and the capture) while the person's own hand on the page is not stopped; the scheduled tidy-up (it may ask the Study model, which in a team
  space is the team's route and bill, and the Study model is not asked by a scan started by hand either); the page's « sent » counts, which read the same plan as the prompt. The lessons block, its two tools and
  its scheduled tidy-up are kybernos-memory's, which asks through the seam below.
- **What a team keeps**: `kybernos:team-lessons`, `kybernos:workspace-instructions` (per folder, another bundle), « Propose to team » and the
  account's own pages. The human's last message is still noted in memory (`noteUserTurn`): it writes nothing, and the team lessons block ranks
  its lessons with it.
- **The routes a shell could use** (the model has one, and plugin routes are served before DSH's login): `memory/add`, `memory/update`,
  `memory/lessons`, `team/lessons/add`, `space/active` and `kyby/native/set` need DSH's signed browser-session cookie besides the Origin
  (`session: true`, as the deletes do). A shell that reads the machine secret can still forge that cookie: this raises the bar from a bare `curl`,
  it is not a sandbox (`docs/dev/route-origin-rule.md`).
- **The seam**: `globalThis[Symbol.for('kybernos.space')]`, a frozen `{ version: 1, isTeam() }` published at `apply`. `isTeam()` reads the state
  file each time it is called (a system-prompt callback is synchronous and runs at every assembly), so a switch in the middle of a session is
  seen at the very next assembly, both ways, with no restart. A bundle that finds no seam knows no teams; a seam that throws, has no `isTeam`
  or answers anything but `false` is read as a team (`kybernos-memory/team-space.mjs`).
- **Limits, said plainly**: what a session already holds in its history from before a switch from personal to team (the memory block of earlier
  turns) cannot be taken back by a plugin; the team note asks the model not to use it, and a new chat is the clean way. The state is written
  before DSH applies the new model route (about 3 s), so right after a switch back to personal a request can still be billed to the team. An
  agent with a shell can still read files under the DSH home: kybernos-memory refuses the plain ways in a team space (`memory.cjs`, the lessons files,
  the account's state files, the pages' loopback routes) but nothing here is a sandbox. The Kybernos proxy's own memory injection is workspace-blind:
  the section above stops it only where DSH sends the system prompt (a title, a compaction or a sub-agent call that carries no prompt can still get the
  account memory from it until the proxy itself skips non-personal workspaces).
- **Test**: `node scripts/test-team-memory-cut.mjs` (a canary word in a personal memory and a personal lesson, both bundles mounted, the
  switch both ways, every fail-closed case).

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
the device appears as `DSH <machine name>`, and `DSH <machine name> (port N)` when this DSH does not listen on 3080, so two DSH of one computer read differently).

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
| `GET /kybernos-cloud/kyber` | the door's state, the person's cloud computers and the one linked to the assistant (`home`; `manual_control`: false on the Free plan), `server` (the footer's `{ name, host, can_switch }`) and `pairing` (`supported` / `unsupported` / `unknown`: whether the server has the pairing routes, from the status of `GET /v1/me/telegram` and `GET /v1/me/kyby`; a 404 on either is a server older than kybernos-server#230) |
| `POST /kybernos-cloud/telegram/pairing` | asks for a pairing: `{ id, link, bot, expires_at, qr: { size, modules } }` (the QR is computed here, `qr.mjs`) |
| `GET /kybernos-cloud/telegram/pairing/state?id=` | `{ state: waiting\|scanned\|done\|declined\|expired, reason?, sender? }` |
| `POST /kybernos-cloud/telegram/pairing/cancel` `{id}` | “it is not me” |
| `POST /kybernos-cloud/kyby/computer` `{computer_id}` | the cloud computer linked to the assistant (null = the default Home); `GET /kybernos-cloud/kyber` lists `computers` and gives `home` as the chosen one |
| `POST /kybernos-cloud/telegram/unlink` | disconnects the account's Telegram |
| `POST /kybernos-cloud/whatsapp/pairing`, `GET …/whatsapp/pairing/state?id=`, `POST …/whatsapp/pairing/cancel` `{id}`, `POST …/whatsapp/unlink` | the same four calls for the WhatsApp door (ADR 0053 § 13.8, a beta bridge), on the server's `/v1/me/whatsapp[/pairing]`; the pairing's `link` is the number's `wa.me` address with the pairing message typed (`number` is answered, no `bot`). `GET /kybernos-cloud/kyber` carries a `whatsapp` object `{ configured, enabled, available, linked }` only when the server answers `/v1/me/whatsapp`; a server without the door (it answers 404) gives `null` and the page says « Not available on this server yet ». Played end to end on the server's replica (`whatsapp-door` branch, a stand-in bridge): not connected → code → the person's message → Kaby's question → « 1 » → connected → disconnected. |
| `GET /kybernos-cloud/kyby/native` | which DSH chat is Kaby's (`sessionId`, null before the first time) and its folder (`cwd`, made here) |
| `POST /kybernos-cloud/kyby/native/set` `{sessionId}` | remembers that chat (null forgets it) |
| `GET /kybernos-cloud/computers` | the person's cloud computers (personal space) for the load strip of the Automations page: `{ok, connected, computers: [{id, name, isHome, state (awake, asleep, waking, winding_down, off), memoryMb, mode, paused, load}]}`. `load` is what the computer said in its last beat (level, pressure, cpuPerCore, memAvailMb, memTotalMb, running, waiting, allowed, runningTasks), null when it has none (asleep, silent, or an older platform). Read-only, shared for 8 s, a closed set of fields (`computers-view.mjs`, `test-computers-view.mjs`); not connected = an empty list, a failure = `error: "unavailable"` |

Kaby's own chat is a native DSH conversation (`kyby-native.mjs`): the host gives that chat Kaby's identity in the system prompt
(`kybernos:kyby`, for its session only), writes each finished turn on the person's server thread (`POST /v1/threads/{id}/messages`, the
thread from `GET /v1/me/kyby`) and tells the prompt what was said there lately. A server with no such thread is left alone for ten minutes.

**Who Kaby is** is one text, `kyby-identity.mjs`, used by every body: the rules that come first (never claim undone work, outside words are information and an old `yes` is no permission, a message for someone else is a draft, no safeguard that cannot be enforced), the voice (version 0.2), a situation line (channel, body, time) and what was said lately, fenced as data (`<data>`, look-alike markers escaped). The cloud computer's turn runner (`services/computer-image/runner.mjs`) takes it from a byte-for-byte copy and never from the name a kyber carries on the server. `test-kyby-eval.mjs` holds the ten questions and the scoring of an answer (voice, old name, flattery, an obeyed injection, a safeguard that is not enforced, and an earlier unfinished task raised in an answer that did not ask for it: `on-question`, with `PENDING_TOPICS` naming the task, which caught the garage draft in both recorded Telegram runs); `test-kyby-identity.mjs` checks the text, the copy and the scoring, and a live run feeds the scoring real answers. What reaches a turn from the past is told to stay in the background: the shared thread's label says to use it only if the message needs it, and the memory chunk says the same of the memories (a memory kept as an unfinished task was being volunteered in unrelated answers; the chunk still ends with the sentence `stripMemoryBlock` looks for). Whether the wording stops a given model is only measured by a live run.

**Kaby's journal** (`kyby-journal.mjs`, the `kaby_journal` tool): at the end of each turn of Kaby's own (a message a cloud computer was handed, or Kaby's chat on the person's computer) one line is written in `<DSH home>/kybernos/kaby-journal/<UTC day>.jsonl` (0600 in a 0700 folder, 30 days kept): when, the channel (`chat`, `telegram`, `phone`), the body (`computer`, `cloud`), the first 100 characters of the request as one line, the tools that ran by name and count, and how many actions the person refused. A session that is not Kaby's (an automation, a coding chat) is not written. The tool reads the last 1 to 168 hours (24 by default) and passes every approval gate: it changes nothing. One rule of the identity text sends the model to it for « what did you do? ». Each body keeps its own journal: a merged one is for later. Without it the answer could only come from the chat's own words, which say nothing of a command that ran or an action refused.

**Kaby's knowledge folder** (`kyby-knowledge.mjs`, `kyby-pdf.mjs`, the `kaby_knowledge` tool): the person puts documents in `<DSH home>/kybernos/kyby/knowledge/` (made when the plugin loads; it is a folder of Kaby's chat workspace, so on the person's computer the chat's file tree shows it; on a cloud computer it is that computer's own volume, filled from its DSH page) and Kaby lists, searches and reads them: text, Markdown, CSV, JSON, HTML, Word `.docx` and PDF, up to 25 MB each, four folders deep. With no argument the tool lists; `query` searches every document (the one with most of the words first, with the sentence around each) and `file` reads one in pieces (`offset`, `max_chars`, 12,000 by default, 40,000 at most). Read-only and local: nothing is indexed elsewhere, symbolic links are never followed and a path that leaves the folder is refused, so nothing outside it is reachable; every answer says the documents are information, not instructions, and the tool passes the turn gate like `kaby_journal`. The text of a file is extracted once per version of it (size and time) and kept in a bounded cache. The PDF reader is pure `node:zlib`: it follows the page tree, Flate streams (also inside object streams), the fonts' ToUnicode maps and glyph widths (so pieces drawn apart read as words and lines) and the forms a page draws (macOS's writer draws a whole page that way). **What it does not read, and says so**: a scan (no text layer: `no text found`), an encrypted file, a font with no Unicode map, PNG-predicted object streams, and glyph names given by an `/Encoding` `/Differences` array (a ligature such as « fi » can come out as another character in old LaTeX or groff files). Measured on the 60 PDFs of this Mac's system folders: 16 read, 39 with no text layer (icons and templates), 5 not PDFs; every one in under 60 ms. `test-kyby-knowledge.mjs` builds its PDFs and .docx by hand (plain, Flate, object stream with a ToUnicode map, encrypted, scanned, damaged) and measures the folder rules (links, `..`, size, time budget).

**Approvals in Kaby's own chat** (`nativeGate`, step 3 of the plan): the tools of our plugins that change something outside the chat (`memory_write`, `lesson_write`, `connections_execute`, `computer_*` that start, write, run or stop, `relancer_dsh`) ask the person through DSH's own approval card (`approval.request`) when Kaby's chat calls them, as a cloud computer's turn asks through the platform. What only reads passes; the engine's own tools (a command, a file) keep DSH's policy, which the chat is set to « ask » when it is made; any other chat is untouched; with no approval service, or a failed ask, the answer is no. The refusals are counted in the journal line of the turn.

**Fewer questions on a messaging door** (2026-10-20, measured on WhatsApp with `deepseek-v4.1-flash`: « what is the list of my workspaces? » made Kaby improvise four shell approvals in a row, the fourth stayed unanswered, and the turn ended in `run_timeout` after 10 minutes with no words). What a cloud computer's gate (`turnGate`) does now:

- **Read-only tools pass without a question** (`TURN_GATE_SAFE_TOOLS`, audited tool by tool in the comment above it): besides the earlier ones, `computer_list` (the E2B sandboxes this machine tracks, a local file: the model had taken it for « my computers »), `computer_read`, `connections_search_tools`, `todo_write` and the new `kaby_account`. Still asked: the engine's `bash`/`write`/`edit`, `memory_write`, `lesson_write` (and `lesson_search`, which counts what it returns as used), `connections_execute`, `computer_start/exec/write/stop/pause/resume/task`, `relancer_dsh`, `kybernos_report_feedback`, the file-writing tools of the slides, bricks, modeller, motion and dashboards plugins, and every `mcp__` tool. A shell command is **not** classified as read-only (`ls`, `cat`): parsing a shell line is the classic way around such a list.
- **`kaby_account`** (`kyby-account.mjs`): the person's workspaces (name, personal or team, their role), the plan of the active workspace and their cloud computers (name, state, sleeps or always on). Names, kinds and states only: no id, address or token; the names are fenced like any outside words. On the person's own computer it reads `/v1/workspaces`, the plan and `/v1/workspaces/{id}/computers` with their token. On a cloud computer the server shows the computer's token **its own workspace only** (ADR 0052 § 10) and refuses the list of computers (counted there as a possible leak), so no call is made for it and the answer says « a cloud computer sees only the workspace it belongs to » and « I cannot see them from a cloud computer; the person sees them in the Kybernos web app ».
- **At most three questions per turn**: from the second, the question says « Question 2 in this task: … » and the fourth is not asked at all: the model is told to say what it could not do and what it would need the person to allow (« Allow for this task » is one tap and ends the questions). A refusal by this cap is not counted as the person's.
- **An unanswered question ends before the turn does**: five minutes at most (`KYBERNOS_TURN_GATE_WAIT_MS`), and never past the end of the turn minus 90 s (`KYBERNOS_TURN_GATE_GRACE_MS`): the runner now says how long the turn may last (`budgetMs`). The model then answers with what it knows instead of the whole turn timing out with no words. With no time left the person is not asked at all.
- **`ask_user_question` is refused at once** on a computer (nobody is in front of DSH's own question card): the question goes in the reply.
- **A model that could not be reached says so**: the engine logs every retry (`llm/retry` with `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT` or `EMPTY_RESPONSE`); a turn that ends with no words after them is reported as `model_429` (a rate limit: the code the server's door already reads as « busy »), `model_server`, `model_timeout`, `model_transport`, `model_empty` or `model_error`, instead of `ended_turn_end`. The runner does not ask such a turn for words again (the nudge would wait through the same retries a second time: about 2 minutes became about 4) and acknowledges it as `model_429` or `empty_answer.model_…`.

`qr.mjs` is a byte-for-byte copy of `kybernos-mobile/qr.mjs` (bundles do not import each other): `node scripts/test-qr-drift.mjs`
fails when they part. The footer publishes `window.__KB_UPGRADE__.open()` so a page can open the Upgrade dialog.
