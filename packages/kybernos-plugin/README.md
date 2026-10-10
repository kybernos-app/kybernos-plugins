# `@local/kybernos` (`packages/kybernos-plugin`)

The core Kybernos bundle: agent teams ("kybers") with their crew views, a run journal, automations, a tools catalog, voice, a
language runtime and ~85 host routes. `client.js` (~31k lines) and `index.js` (~11k) are too big to read linearly: this page comes
from slot registrations, route tables, section banners and the tests.

It is the **socle**: `socle: true` in `packages/kybernos-hub/catalog.json`, always on, its switch locked in the Suite panel.
Socle = `kybernos-plugin`, `kybernos-hub`, `kybernos-theme`, `kybernos-sessions`, `kybernos-skills`. Satellites (switchable):
`kybernos-language`, `-models`, `-slash`, `-auto`, `-relance`, `-flow`, `-composio`, `-cloud`, `-maintenance`, `-bricks`,
`-slides`, `-modeleur`, `-miniapps`, `-computers`, `-workers`, `-modeles-locaux`, `-refs`, `dsh-mermaid`, `dsh-db-viewer`,
`dsh-media-player`.

## What the user sees

- Sidebar entry **Kybernos** (`sidebar.panellist`) opening a main panel: **Agent Teams** (gallery, create / edit / info pages,
  Team Insight, Quality Score), **Workspaces**, **Deliverables**, **Automations** (cron and webhook tasks) and **Resources**
  (Connectors tab only when `@local/kybernos-composio` is booted, Skills tab, Documents tab off via `KB_SHOW_DOCS`). "Kybernos
  Hosted" is off via `KB_SHOW_HOSTED`. The Skills tab mounts the slot `main.kybernos-skills`, with a core page as fallback.
- In the chat: a **Journal** tab (`conversation.view`, runs derived from session events), team-call cards,
  composer extras (token usage, starters, widget chip, voice dictation, artifact selector), read-aloud
  buttons, share / chat-id actions. Also pinned conversations, the Kybernos brand mark and sidebar footer tools.
- Settings sections **Tools**, **Voice**, Referral, Appearance (shortcut to Theme), Security, Support & legal; a first-run
  **onboarding** wizard (see « First-run onboarding » below). An always-on **language runtime** (`<kb-lang-runtime>`) keeps translated languages registered in
  DSH's locale service even when `kybernos-language` is off.

## Host routes

All under `/kybernos/` (plus `/kybernos-technique/{renderer,vendor/three}.js`). Most writes check `sameOriginStrict` (loopback
`Origin`/`Referer` against the real socket port). Also an agent tool `kybernos_signaler_retour` and the projection `kybernos.calls`.

| Family | Routes |
| --- | --- |
| Teams, projects | `load` `yaml` `save` `create` `ui-save` `menu-save` `active-set` `project-data` `workspace-ui-save` `workspace-skills` `pins` `share` `avatar*` `member-*` `team-portraits` `team-cap` `yml-proposer` `yml-appliquer` |
| Runs, insight | `runs` `runs-index` `calls` `calls-index` `search-content` `insight` `insight-save` `workspace-usage` `quality*` `aa` `ws-console-key` `starters-suggest` `compaction` `salary-detect` (purpose not verified) |
| Deliverables | `art-origin\|read\|previews\|reveal\|raw\|action\|progress\|load` `doc-raw` |
| Automations | `tasks` (POST; scheduler ticks every 30 s), `hooks` (public webhook: secret + 60/h default limit) |
| Tools catalog | `tools/state`, `tools/apply` (dry run, dated backup of the profile patch, restore) |
| Voice, TTS | `voice/{config,transcribe,save}` `voice-sample*` `tts/{config,voices,speak,cache,cache-trim}` (engines: `say`, `piper`, `supertonic`, `edge`, and `models`, the speaking models of the user's own providers) `models/audio` `models/audio/{probe,speak,listen}` (the audio models of the providers set up in Models, how each is asked, and using it) `image-models` (live calls moved to `@local/kybernos-call`, which speaks through `tts/speak`) |
| Widget, gateway | `widget.js` `widget/api/{config,conversations,message,account,history-delete,reply}` `gateway/{status,approvals,approvals/decision}` |
| Language, static | `i18n-{translate,models,store}` `icons` `icon` `onboarding` `vendor/{xyflow,leaflet}.*` `kb-places.js` |

## Files, settings, env

Under `$DSH_HOME` (else `~/.dsh`): `kybers/<id>/{kyber.yml,.kyber-ui.json,.kyber-avatars/,memory/,sessions/}`, `kybers/.active/`,
`kybers/tts/{tts.json,cache/}`, `.kyber-pins.json`, `.kyber-shares.json`, `.kyber-workspaces.json`,
`kybernos/{tasks.json (0600), tasks.json.lock (a directory, held while a writer changes the file: the scheduler and the automation-creator skill both take it),settings.json,onboarding.json,gateway-sync-state.json,seeded-skills.json,quality/*.jsonl,i18n/<lang>.json}`,
`skills/automation-creator/SKILL.md`,
`kybernos-widget/{configs.json,conversations/,accounts/,bridge-state.json}` (accounts hold visitor emails), `beta-reports/`,
`profiles/<profile>/cordis.patch.yml` (+ `.bak-outils-*`, Tools tab only) and `AGENTS.md`. Reads `kybernos-cloud.json` (token, API
base) and `.credentials.yaml` (browser-session secret). The art progress file is `<bundle dir>/../.dsh/artifacts/.progress.json`,
beside the bundle rather than in `~/.dsh`. Env: `DSH_HOME`, `HOME`, `DSH_WEB_PORT` (3080), `DSH_PROFILE`, `DSH_VERSION`,
`KYBERNOS_CLOUD_STATE`, `AA_API_KEY`, `KB_FILET_PROVIDER`, `KB_FILET_MODEL`, `KB_SEUIL_COMPACTAGE`, `KB_RETRY_PLAFOND`.

**At boot, unasked** (each step guarded, none blocks the start): registers a cloned preset `kybernos-standard` (compaction summary
model pinned to `deepseek-official/deepseek-flash`, auto-compaction at 70 %), default only if none is chosen; turns on the
`subagent_claude_code` row of every preset definition (in memory); lowers any retry policy above 10 attempts (`settings.update`,
only on a violation); appends a marked "force de proposition" section to `~/.dsh/AGENTS.md` once; writes the `signaler-retour`
skill into `~/.dsh/skills` if its source exists (it does not in this repo); seeds the skills it ships (`skills/<name>/SKILL.md`, today
`automation-creator`) into `<dsh home>/skills` with `seed-skills.mjs`: absent is written, the shipped text is refreshed only while the file is
still byte for byte what we wrote (sha-256 in `kybernos/seeded-skills.json`), and a skill the user wrote or edited under the same name, or
switched off with a `SKILL.md.disabled`, is never touched.

## DSH seams, network

- Client `inject`: `timer slots remote remote.pluginInventory remote.pluginManager sessions workspaces uiWorkspace`. Calls seen:
  `remote.agentTeams.view`, `remote.workspaceFiles`, `remote.pluginInventory`; none to `pluginManager`. Provides a `settingsScope`
  shim when DSH has none (so `dsh-relay` cannot block a cold load); probes `window.__DSH_BOOT__` for the Composio entry. Host:
  `fs settings agentPresets sandboxPolicy sessionController credentials llm webServer sessionProjections web agents agentTeams
  goals sessionPersistence sessionProjectionCache workspaceRegistry shell` and the global `harness`.
- Calls DSH's own `/api/*` on `127.0.0.1:$DSH_WEB_PORT` with a signed `dsh-auth-*` cookie built from the
  `client-connection/browser-session` secret (widget bridge, gateway).
- Outbound: `models.dev` (prices); `artificialanalysis.ai` (only with `AA_API_KEY`); the configured LLM providers (voice,
  starters, portraits, translation); the LiveKit server of `livekit.env`; the feedback relay (`<api>/v1/feedback`, default
  the built-in Kybernos server's address, `BUILTIN_API` in `kybernos-cloud/server-profile.mjs`); the gateway watcher (`/gateway/poll`, widget replies, remote control) **only when both `pairingToken` and `gatewayBase` are set** in `kybernos/settings.json` (no default host: that gateway belongs to the old stack);
  `edge-tts` sends text to Microsoft. In the browser `kb-places.js` uses photon.komoot.io, nominatim.openstreetmap.org, CARTO tiles
  and a jsdelivr fallback. Helpers: `tools/visages-equipe.py`.

## First-run onboarding

A full-screen wizard (plain DOM, `KB-OB-*` blocks of `client.js`) opens once on a fresh install, and again from the
« Replay » button at the top of Kybernos Settings (`kybernos-sessions` fires the window event `kybernos:onboarding`).
It is a single column in the look of dev.kybernos.app (light or dark, whichever the page behind it is) with the K logo.

- **Screens:** welcome, profession, display mode, then « which model do you want to work with? ». The model screen is
  skipped when a model already works (Kybernos Cloud connected, or a pulled Ollama model); otherwise it offers:
  - **the account** (`/kybernos-cloud/start` + `poll`): the wizard shows the code, the person types it on the page that
    opens (the page never displays it: ADR 0009 of the server), and the connection is picked up by itself;
  - **an API key** for Anthropic, OpenAI, DeepSeek or Google: pasted in the wizard, checked with the provider
    (`POST /kybernos-models/key/check`, one word back), then saved by `window.__KB_MODELS__.saveKey`, the same write as
    the Add provider flow. Another provider, or `kybernos-models` off, is handed to Settings;
  - **a local model**: the recommendation and the connection come from `window.__KB_LOCAL__` of
    `kybernos-modeles-locaux`; the download is the host's own `/modeles-locaux/installer` job (Homebrew, macOS), with a
    progress bar. Leaving the wizard mid-download keeps it going and connects the model when it ends.
  A way whose bundle is off is not shown; the hand-over to Settings names the page by its nav id, so it works in every
  language.
- **Closing:** Skip, the cross and Escape all record what was chosen so far; it is never asked twice.
- **Texts:** shipped here for English (the default), French, Spanish and Arabic (right-to-left), in `KB_OB_T`. They are
  not read from the translation runtime: that one needs a model, and this wizard is what gets the person one. The
  wizard's language is its own (menu in its header); it starts from the app's language and never changes it.
- **State:** `$DSH_HOME/kybernos/onboarding.json`, rules in `onboarding-state.mjs`. `profil` and `uiMode` keep the ids
  of the previous wizard; `model` (`cloud`, `key`, `local`, `later`) and `lang` are new and read as `null` in an older
  file. The version stays at 1 on purpose: raising it would reopen the wizard for every existing user.
- **Not done yet:** « a model already works » only knows the connected account and a pulled Ollama model (a key
  already in the profile is not detected); nothing reads `profil` and `uiMode`.

### « This chat can't answer yet » (`KbNeedModel`)

When the latest turn of a chat failed with `MISSING_CREDENTIAL` (the model's key is not set), a card sits right above the box
(slot `conversation.input.dock`, `order: 20`). The engine's own sentence stays in the failed turn; the card says it in a person's words
(the four shipped languages, the app's language first), and offers the shortest way out:

- **the missing key itself**: one field, labelled with the route; the reference (`*_API_KEY`) and the route are read from the
  engine's sentence (`kbObNeedModel`, tested). Saved by `window.__KB_MODELS__.saveCredential(ref, key)`; then « Put my message back
  in the box » (`kbPrefillDraft`: the person presses Enter, nothing is sent for them);
- **the ways of the first run** (a Kybernos account, a model on this computer): the wizard's model step on its own
  (`kbObStandaloneOpen`: no steps, no onboarding file written). The connection does not change the chat's model: the card says to
  pick the new one in the selector.

It reads the chat through `useChat((c) => c.nodes.valuesCache)` and `c.navigation.current` (shapes measured on the real GUI), and is gone as
soon as the person sends again; it comes back if that new turn fails the same way.

## Tests

```bash
node scripts/test-onboarding.mjs                       # KB-OB-CORE block: texts in 4 languages, language choice, steps, theme probe, K artwork
node packages/kybernos-plugin/test-onboarding-state.mjs  # the state file: version, answers, replay, older files
node packages/kybernos-models/test-key-check.mjs       # the key check: where a key may go, the one-word answer, the route's guards
node packages/kybernos-modeles-locaux/test-seam.mjs    # the recommendation and the route profile the wizard shares with the panel
source scripts/sandbox/env.sh && node scripts/check-onboarding-live.mjs   # the wizard on the sandbox: account, key saved, model connected, hand-over (refuses :3080)
node packages/kybernos-plugin/test-i18n-store.mjs      # 60 checks: disk translation store and its route, temp dir
node packages/kybernos-plugin/test-i18n-translate.mjs  # 47: translate batches against a fake llm.stream
node packages/kybernos-plugin/test-lang-runtime.mjs    # 89: the <kb-lang-runtime> block with fake locale and storage
node scripts/test-pins-host.mjs                        # KB-PINS-CORE block of index.js
node scripts/test-scheduled-tasks-host.mjs             # KB-TASKS-CORE block: cron, validation, store, trigger
node packages/kybernos-plugin/test-automation-creator.mjs  # 64: the shipped skill's script, run with sh on a temp DSH_HOME (lock, stale lock, ten writers at once)
node packages/kybernos-plugin/test-seed-skills.mjs     # 27: skill seeding (a user's own skill is never overwritten)
node scripts/test-shipped-skills-wiring.mjs            # the real index.js seeds under DSH_HOME, not under the other HOME
node scripts/test-automation-creator-parity.mjs        # the skill validates crons and zones exactly like the scheduler
node scripts/test-seed-skills-drift.mjs                # seed-skills.mjs here = the one of kybernos-theme
node scripts/boot-check.mjs                            # live GUI only: detects "Failed to load plugins"
```

What a user sees needs the real GUI (`docs/dev/live-testing.md`). **Untested in this repo**: run / call / insight / quality
derivation, widget bridge, gateway watcher, voice and TTS, tools catalog, preset and retry modules (`index.js` cites
`scripts/test-kybernos-host.mjs`, which does not exist).

## Known limits

- **Automation approvals.** An automation set to `ask` (the default; anything but an explicit `auto`) starts its session on the first configured
  permission preset that asks for approval (`workspace-write` in the stock table), set before the prompt is sent; if the host cannot do that
  the run is not started and the reason is on the run. `auto` leaves the profile default, so it never widens permissions. DSH itself gates only
  the sandbox: it does not ask before an MCP tool acts (measured: a Stripe write ran under `ask` with no request). So the plugin adds a
  `tools/pre-execute` listener for the sessions it started for an `ask` automation and for their sub-agents (a child session records its
  parent in `header.parentSession`); a session a person opened is never touched. The listener turns an MCP call into an approval request
  unless the call is provably a read (`kbMcpGate`, in the tested core block): the engine gives no read-only hint for MCP tools, so it works on
  names. A name with a write word (send, create, delete, update, pay, click...) is gated, one with only read words (get, list, search, find...) goes
  through, and a name it does not understand is gated. Composio is judged on the actions inside `COMPOSIO_MULTI_EXECUTE_TOOL`
  (`GMAIL_SEND_EMAIL` asks, `GMAIL_LIST_LABELS` does not); its remote bash and workbench, which run code with the connected accounts, always ask.
  The request names the action and never carries the arguments (they can hold personal data). The run then **waits** in its session until
  someone answers (the DSH sidebar shows "Waiting for approval"; Reject makes the agent see "the user rejected tool"); nothing times it out.
  Not covered: built-in tools (the sandbox owns them), and any tool whose name hides what it does.
- **Public surface.** DSH serves plugin routes before its own auth (comment in `index.js`). `widget.js`, `widget/api/config`
  (GET), `message`, `account` and `history-delete` are public with CORS `*`; with a widget enabled, visitor text becomes a
  `session/prompt` in a live DSH session (5 s bridge tick). The webhook secret travels in the query string, and `ws-console-key`
  hands `wsAdminKey` to the page, which passes it as `?key=` to an iframe.
- Legacy engine patches `workspace-pins` and `goal-affichage` (`scripts/patches.json`) are still applied below DSH 0.2.0-rc.2;
  on 0.2.0-rc.2 the plugin does the job (the Goal-card part was not measured live).
- Dead or stale: `shared-ui.css` (86 KB, read by nothing: `scripts/build-shared-ui.mjs`, which is meant to inline it into `SHARED_UI_CSS` in
  `client.js`, is missing; kept because dropping the design-system input is the owner's call, not provable by grep);
  `technique/workflow-traducteur.mjs` is also pasted into `client.js`, contract test missing; `docs/handoff/*` cited in
  comments is absent. `client.js` is 2.4 MB (repo guard: no personal-path scan above 2 MB, fails at 4 MB). The scheduler runs only
  while DSH runs; catch-up after downtime is not verified.
