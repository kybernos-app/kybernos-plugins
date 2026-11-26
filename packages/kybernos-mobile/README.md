# `@local/kybernos-mobile`

DSH on a phone, in two parts that do not depend on each other (and a third that only exists inside the Kybernos app, below):

1. **The layout** (every account, every plan): the DSH shell becomes usable below 700 px.
2. **The phone link**: a QR code on the computer links a phone to it, through the Kybernos relay, end to end encrypted.
   The phone then runs the computer's own DSH page. Whether an account has it is the server's plan (the feature `remote`,
   in the Free plan too since 2026-10-15); the plugin only shows what the server answers.

A failure in the second part never touches the first, and neither can stop DSH from starting.

## Inside the Kybernos app

The Kybernos phone app (`kybernos-host/app`) runs the engine ON the phone and shows this same interface in a WebView, whose user agent ends with `KybernosHost/<version> (ios|android)`. There the layout above is exactly what makes the interface usable (the app's payload carries this bundle for that), and the phone link has no meaning: the phone is the device. So, and only there:

- the host half mounts no link routes and starts no relay (it recognises the app by the platform of the embedded engine, `ios` or `android`);
- the browser half registers a Settings page called « The Kybernos app » (in the same place of the list, under Devices & cloud) instead of « Phone and channels » (**in Simple the page is not registered: the same content is drawn inside About**, item 28): the model key (opens the app's secure key screen through `kybernos://settings`; **not drawn in Simple**: the models come from Kybernos Models, a phone in Simple has no key of its own to keep), the engine log (`kybernos://log`), and what a phone changes for automations (they run while the app is open or was just used; a suspended app runs what came due as soon as you come back; for a fixed time with the phone locked, use a cloud computer);
- `window.__KB_APP__ = { version, platform, appVersion, openSettings, openLog }` is there for the other bundles, `<html>` gets the classes `kb-app` and `kb-app-ios` / `kb-app-android`, and the app is told once (`ReactNativeWebView.postMessage`, `{ kybernos: 'app-entry' }`) that the interface has its entry, so it drops the small gear button it shows until then;
- the phone link window (`window.__KB_MOBILE__`) is not published, so the account menu and Kaby's strip do not offer it.
- store rules (`kybernos-host/STORES.md` items 1, 5, 6): under `html.kb-app` the controls that buy a plan, create an account or add a plugin are hidden by their `data-kb` hooks (`STORE_HIDDEN` in `client.js`; the test checks every hook still exists in the bundle that draws it). The desktop and the browser keep them.
- a « Report » link under each finished answer (slot `conversation.chat.turnTail`, id `kybernos-mobile-report`): reason, optional comment, optional answer text (ticked by the person, editable). It saves the report in the core feedback box, then sends it with the signed-in account; signed out or offline, it offers an e-mail to the product's address. Nothing is added in a browser.

In a browser none of this exists: the user agent is not the app's, and nothing above runs.

## Kaby mode (Simple: the full app, filtered by a locked preset)

**Simple is a preset of the full app, not a second app.** A **switch the app's shell sets**: the WebView's user agent ends with `KybernosHost/<version> (ios|android) KabyMode/1`. Then the same DSH, wherever it runs (a cloud computer, the person's own computer through the phone link, an engine on the phone), opens Kaby's conversation directly and shows **its own screens**: the phone's drawer (burger, dock with the avatar, the where pill), the account menu the avatar opens, and Settings, each of them **filtered by the locked « Simple » preset** that the Theme plugin ships (`window.__KB_THEME_LOCKED__.get('locked-simple')`: the main rows, the account menu entries and the Settings pages, read by the Kybernos plugin, which hides the rest). Nothing of that is drawn or kept here: this bundle has no menu, no Settings sheet, no Reminders / Apps / Conversations pages of its own any more. Without the token (or with `KabyMode/0`) the **full app** is exactly as above: nothing in this section runs, the seam keeps its five fields. A browser that carries the words but not the app's own token is not Kaby mode either.

**Fallback.** If the locked preset cannot be read (no Theme plugin, a seam of another version, no document), the plugin filters nothing: Simple shows the full app's drawer, account menu and Settings **unfiltered**. Nothing here knows about it.

What Kaby mode itself adds is **one declarative list**, `kaby-mode.mjs` (`KABY_SHOW`, `KABY_HIDE`): the host half builds the stylesheet from it (`/kybernos-mobile/kaby.css`, and the same rules in the page head with a two-line script that puts the class `kb-kaby` on `<html>` before the first paint), the browser half only needs the class. Every rule is keyed on `data-slot` / `data-kb` hooks, never on a hashed class or a translated label, and is `display: none` under `html.kb-kaby`: the hidden thing stays in the page, the desktop and the full app keep it. The list has **no layout rule and hides nothing of the app's navigation** (a test checks that no selector touches the sidebar, the drawer, the dock, the account menu or the Settings dialog): the preset is the only thing that filters those.

Shown (`KABY_SHOW`):

- `conversation`: Kaby's chat, opened with no tap (the kyber bundle recognises the switch);
- `composer`: the message field, attach and send;
- `answers`: the answers, with copy and the rating;
- `approval`: DSH's own approval card, answered in the page;
- `report`: the « Report » link under each finished answer (store rule);
- `drawer`: the phone's own drawer (the burger, `data-kb="mobile-menu"`), the same as in the full app. Its main rows are the preset's: `kyber` (Kaby), `tasks` (« Reminders »: the real Automations page) and `connectors` (« Apps »: the real Connectors page), in that order, the others hidden (`unlisted: 'hide'`);
- `account-menu`: the avatar of the dock (`data-kb="mobile-avatar"`) opens the web app's own account menu, filtered to the preset's entries (Appearance, Settings, Help, Send feedback, and Sign in when signed out). The native Account, Plans and Referral screens stay reachable by the app's parts in About, below;
- `settings`: DSH's own Settings dialog (`data-shortcut-modal="settings"`), filtered to the five pages of the preset (Theme, Language, Memory & lessons, About, Kaby; step 6 part 2: Usage and Connectors are hidden, and General too, in the phone layout only); it is the full app's dialog, with the Kybernos plugin hiding the other pages and the settings search skipping them. « The Kybernos app » is **no longer a page of Simple's Settings** (owner's list, item 28: it doubled About): its parts are filed under About (`window.__KB_ABOUT_EXTRA__`, id `kybernos-app`, drawn by the maintenance bundle between the links row and the update switch; nothing was deleted), and they start with what only the phone offers and DSH has no page for: Notifications (when the shell handles them), where Kaby works, Account and plan with Referral (when the shell lists `referral`), Help and report, « Need more? »;
- `mode-switch`: « Need more? » in the app's parts of About, the line that asks the shell for Advanced mode (the `set-mode` message, `docs/dev/kaby-mode-shell-contract.md` section 9). Drawn only when the shell says it can (`capabilities.mode` in `shell-state`); the Kaby app of the stores, which has no Advanced mode, never shows it. In the full app the same ask is « Simple mode » on the app's own page of Settings, drawn only when the user agent lists `mode` in `KybernosCaps`;
- `connect-card`: « Kaby wants to connect <app> » (Connect / Not now): the shell's sign-in sheet flow, glue with no equivalent.

Two things in Kaby mode are words, not rows. The composer's empty text is « Ask Kaby anything » (« Demande quelque chose à Kaby »): the engine's own « Describe what you want to build, / commands, @ files or sessions » is developer wording and a phone has no such keys, so the page rewrites the value of the placeholder's text node and the field's accessible name, puts them back when the engine writes its sentence again, and leaves a field that cannot be typed in alone. And the control under « Help and report » is a button that says « Report an answer » (the phone's own CSS turns every other report control into a bare flag under an answer).

Hidden (`KABY_HIDE`), all of it inside the chat screen, which the preset's three surfaces (main menu, account menu, Settings) do not cover:

- `header`: DSH's chat header (title, Teams, the phone-call button, « More actions », the Chat / Journal / Trajectory views);
- `rightbar`: the right bar and the shell's empty bottom row;
- `composer-options`: the access-mode shield, dictation and the input device, « / » (the engine's own button, the « + » list already holds the commands) and the voice-input setup. **Not hidden any more (step 6):** the model picker (the web app's own, the whole Kybernos Models catalogue, so a person picks a model as on the web), « where the work runs » (kybernos-computers' execution-environment control, and kybernos-cloud's « Run on » beside it) and the « + » list: Add file, Goal, Plan, Feedback, the Commands group, the Skills group and the « @ » suggestions are the web app's, nothing is cut out of it any more (the row `composer-commands` is deleted). The phone's small on-device model, when the engine runs it, is a model like the others in that picker;
- `kaby-strip`: Kaby's strip above the composer (« Remote control · … », Telegram, « This computer · Ready », « Customise Kaby »);
- `new-chat`: the new-chat home (headline and « Beta », template shelf, cloud-computer card, folder and mode pickers);
- `model-keys`: « Add a model » (own model keys) in the « No model » notice and « A model on this computer » in the « This chat can’t answer yet » notice; their « Sign in » stays;
- `answer-extras`: « summarize » and « Action » under an answer;
- `process`: the agent's steps in the chat — its thinking line, its commands (bash) and its other tool calls — while it works and after it is done (owner's list items 32 and 35: Simple = the answer, a status and Details). The status line and the « Worked n s » line under a finished turn stay: that line is the door. A tap on it makes the engine open the turn's process (`aria-expanded="true"` on the line's button) and the steps it then shows are shown (Details); every other step is kept out of sight by the engine itself (`data-turn-process-hidden`). Interactive cards — `ask_user_question`, approval cards (`[data-slot*="approval"]`) and connector asks (`[data-kb="connector-ask"]`) — are never hidden, even when nested inside a tool card or a process member. Because DSH renders chat flow rows as flat siblings keyed by `data-chat-turn` without a per-turn wrapper, the Details guard is scoped to the chat flow (other finished turns keep their collapsed steps hidden via DSH's own `data-turn-process-hidden`);

**Step 6 (what stopped being hidden or drawn, and why).** Simple is a preset of the full app, so a function the web has stays, unless the preset has a reason: the real model picker and the whole « + » list are back (the old reason, « the person does not choose a model », was wrong), Kaby's frozen answer chip is deleted, and the page's own « On this phone » pill is drawn on a cloud connection only. The « + » list is the engine's fixed bottom sheet: the soft keyboard of an iPhone shrinks only the *visual* viewport, so the sheet is lifted by the covered height (`--kbmob-kbd`) and capped to the visual height (`--kbmob-vvh`), both set from `visualViewport` in `client.js`; the composer keeps its focus (letting go would close the list). Still hidden in the chat, one line each: the access-mode shield (the preset has no permission to choose), « / » (the « + » list offers the commands), dictation, the input device and the artifact button (the shell has not planned a microphone, and the preset has no artifact button), the voice-input setup (goes with dictation).
**Step 6, part 2 (2026-11-23), and which kind of change each one is.**

- *Finger size* — **preset setting** (Theme plugin): the Theme setting « Touch comfort » (on in `locked-simple`), one static stylesheet under a 480 px media query: menus and dialogs as bottom sheets, rows a thumb high (54-62 px), the Settings pages a size up (`zoom`), the search palette hung from the top (the soft keyboard rises from the bottom), tab strips (Kaby, Language, the Theme editor) as a column. Nothing of it is in this bundle.
- *Settings sections* — **preset setting**: `locked-simple` lists six pages (see « settings » above).
- *Back on a page* — **page code** (this bundle): an in-page screen is the lowest layer (`layers top: "page"`), so Back leaves the page for the screen it was opened from (the chat), and only then does the shell's own Back leave the app (contract §8).
- *French and the phone's words* — **page code**, no native change: (a) the core plugin's language runtime puts DSH on its own French (`fr`, shipped since rc.5) when Kybernos is French in Kaby mode, once per start; the French drawer, menus and Settings are then the engine's own, and a person who picks English on the Language page keeps English (DSH's `fr` is also read as Kybernos' French, no longer copied as an id Kybernos has no table for); (b) `startPhoneWords` (this bundle) says « ce téléphone » / « this phone » for « cet ordinateur », « cette machine », « this computer » and « this machine » on the Settings pages, the menus and the Automations load strip, on the phone's own engine only (`KybernosPlace/local`), never in code, fields, chats or a memory lesson; (c) the dock says « Nouveau chat » and the app page's platform word follows the language.
- *The app's parts in About (the page « The Kybernos app » until item 28)* — **two preset settings (2026-11-23), the rest not changed** (the owner's call): in Simple the preset's `appPage` option (Theme plugin, `locked-simple`) leaves out the *Engine log* card (a developer's card) and draws the computer card only when a computer is really linked (the person's own computer through the phone link, the phone's own engine as « Where Kaby works », Kaby's cloud computer; not « No information yet », not « Your computer: ready » for the phone's own page). The page reads it when it draws (`presetAppPage`, the only read of `__KB_THEME_LOCKED__` left in this bundle); a preset that cannot be read, or a missing word, draws everything, and the full app never reads it. The other cards stay as they were: Account and plan, Help and report, App settings, Open-source components and Automations on this phone (App settings is the one row that replaces the shell's gear; the key card is not drawn in Simple). The four other proposals (hand-over note, step 6 part 2, item 6) are not applied: they are the owner's.

- `store-controls`: buy, create-account and add-a-plugin controls, hidden by the same hooks as in the full app (`STORE_HIDDEN`, items 1, 5, 6 of `STORES.md`).

What was removed in this step (2026-11-22), because the full app already has the same screen: the slim top bar with its two buttons, the four-row menu drawer, the Reminders page (a copy of the Automations list), the Apps page (a copy of the Connectors card), the Conversations page (a copy of the sidebar's list), the « Kaby settings » sheet with its Connections, Memory, Appearance cards, the gear that chose between the real Settings and that sheet, and the rows `sidebar` and `settings-dialog` of `KABY_HIDE` with the layout rule that made room for the bar.

The page title and every visible word of Kaby mode come from this bundle or from DSH's chat: no « DeepSeek Harness » wording is drawn.

The connection card, the notification triggers and the messages to the shell are in [`docs/dev/kaby-mode-shell-contract.md`](../../docs/dev/kaby-mode-shell-contract.md) (the list of what the shell must do, every message and field, the new-window problem). Short version: `window.__KB_APP__` gains `mode: "kaby"`, `receive`, `shell`, `requestConnect({ toolkit, name })` and `askNotifications(why)`; the page posts `kaby-ready`, `open-screen`, `authorize` (the sign-in address, to open in the system browser sheet), `notifications-ask`; the shell answers `shell-state`, `authorize-result`, `notifications-state`. A connection only starts on the person's tap and is proved by the server, not by the sheet.

Checks: `node packages/kybernos-mobile/test-kaby-mode.mjs` (the list, the switch, the messages, the card, the triggers, on a fake DOM) and `source scripts/sandbox/env.sh && node scripts/check-kaby-mode-live.mjs --out <dir>` (a real DSH in the sandbox at 390 px with a stub model, the shell played by the script; screenshots in `<dir>/shots`).

## The display mode: Simple or Complete (2026-11-24)

**One mode, two effects.** Simple or Complete drives (1) the navigation preset (the locked « Simple » arrangement of the main menu, the account menu and the Settings pages: the Kybernos plugin follows `kb-simple`) and (2) the technical view (the agent's thinking, commands and tool calls, folded: the `kaby-mode.mjs` rows whose `scope` is `mode`). It is **stored per account** (the DSH folder: `mobile-mode.json`, route `/kybernos-mobile/mode`: a read needs the Origin, a write also needs DSH's signed browser session, and one made through the phone link is refused), not per device.

**Three axes that do not depend on one another:**

| Axis | What it is | Where it lives |
|---|---|---|
| Layout | the width of the screen: the phone's own frame under 700 px | `mobile.css` and the touch layer |
| Host | where the page runs: the Kybernos app's WebView (`KybernosHost/<v> (ios\|android)`, class `kb-kaby` when it carries `KabyMode/<n>`), a phone browser, a computer | the user agent |
| Mode | Simple or Complete | `mode.mjs`, class `kb-simple`, `data-kb-mode`, `data-kb-mode-pref`, `data-kb-mode-source` |

The web on a computer is **not** a mobile preset: under Auto it is Complete whatever the width of its window.

## Phone runtime prompt (`index.js`, `onPhoneHost`)

Strictly when the engine runs on the phone (`ios` or `android`, checked by `onPhoneHost()`), the host registers a `systemPrompt.context` chunk (`kybernos:phone-runtime`, order `115`, fail-open if the seam is absent) for every chat on the phone engine. It tells the model that it is running on a phone where external programs, subprocesses and standalone CLIs (such as Node) cannot start, not to propose or retry external CLI commands, to explain plainly that a remote or cloud Kybernos computer is needed, and never to promise automatic routing. Nothing is registered on desktop (`darwin`, `linux`, `win32`).

**Auto, once per load, in this order** (`bootMode` in `mode.mjs`, written in the head before the first paint, never re-evaluated, the width never read): an explicit choice, then inside the app the shell's word (` KabyMode/<n>` = Simple, none = Complete), then a touch device (touch points and a coarse primary pointer) = Simple, else Complete. `data-kb-mode-source` says which one answered (`choice`, `shell`, `touch`, `default`).

**Where to switch** (all three go through the seam `window.__KB_MODE__`: `state()`, `set(pref)`, `subscribe()`, `wouldBe(pref)`, `openSheet()`, the window event `kb-mode-change`): the **segment** Auto · Simple · Complete at the foot of the drawer (inside the app), a **Display row** in the account menu next to Appearance (kybernos-cloud), and a **command** in the ⌘K palette (kybernos-search, through `window.__KB_COMMANDS__`). The row and the commands open the **sheet « Display »** (three choices, what Auto means now, a link to Settings › Theme): a bottom sheet on a phone, a dialog on a computer. A choice that changes the mode keeps the choice (the page's copy at once, the account's store right after, at most 1.5 s), tells the shell (`set-mode`, contract section 9b) and reloads; a choice that leaves the mode as it is changes nothing on screen.

The sheet's rules come from the host in the head (`mode.mjs`, not `mobile.css`, which is the phone's alone), with system colours as the fallback, so it reads in light and dark at any width.

## What the user sees

### The layout (a phone only)

The same app, the same organisation: only the layout changes with the width. "A phone" is a viewport at most 700 px
wide, **or** a touch device lying down (at most 500 px high with a coarse pointer: a phone in landscape is 844 px wide and
used to get the desktop shell). Above that nothing changes.

Measured on DSH 0.2.1-alpha.2 at 390 px, before this layout: the sidebar left a permanent rail and squeezed the chat to a
sliver once opened, the title collapsed to 0 px behind eight header buttons, the composer was two rows of 28 px targets
with the model name hidden, the right bar never appeared (DSH stacks it under the chat at 0 px high), and the page
drew under the iPhone's home indicator.

- **Text sizes are real px.** The layer used to ask for `text-size-adjust: 118%` (DSH draws a lot of its text at 10 to 12 px, in `px`, which no `rem` trick reaches), but since
  the engine 0.2.2-rc.5 its own stylesheet says `html { text-size-adjust: 100% }` after ours and wins: the 118 % was lost, and the sizes below showed 15 % too small. They no longer
  depend on it (`--kbmob-tsa: 1`). The engine's own 10 to 12 px texts stay as it draws them.
- The conversation takes the whole screen. A **menu button** (44 px) sits in the top-left corner and opens the sidebar
  as a **drawer** over the chat: same entries in the same order (New chat, Kybers, Workspaces, Creations, Automations,
  Skills, Connectors, Automation tasks, Pinned, the folders and their sessions, the account card), 48 px rows, 16 px text.
  The drawer is 84 % of the screen wide (330 px at most): the rest is the dimmed chat, with no grey strip between. **A tap
  on the dimmed chat, or a swipe to the left, closes it**, and so does picking a session, a page or a global panel (the
  page is then the whole screen). The close goes through DSH's own collapse button, found by its shortcut where DSH draws
  one and **by where it is** otherwise: DSH draws no `aria-keyshortcuts` on an Android phone (measured 2026-10-13), so a
  tap that waited for a shortcut did nothing there. A drawer DSH left open on a phone in landscape is closed once at start
  and after a turn of the screen, unless the person opened it.
- A page's **title** is moved down when it would start under the menu button (the title row is marked
  `data-kbmob-lead`; the title is the page's `h1`, else the largest text of its first 110 px).
- **Header**: one row of 56 px (DSH gives it 76 px for two rows): the title and the page-level actions (Teams, voice
  call, "More actions", right bar). The tab row (Chat, Journal, Trajectory) is parked while Chat is the view shown, and
  comes back on the other views; the sheet below lists the views. Agent Team, share,
  chat ID, video call and call settings are **parked** (rendered, invisible, one pixel: DSH's popovers keep an anchor):
  a tap on "More actions" opens a bottom sheet that lists them, with the composer's parked "/" , artifact and
  execution-environment buttons, in DSH's own labels; its last row opens DSH's own menu. "Open in Finder" is dropped.
- **Composer**: the field, then one row: add, **model (the name is readable)**, access, dictate, send. The "/" button,
  the artifact button and the default execution environment are parked (the sheet lists them; type "/" in the field);
  the input-device list is dropped; the environment shows in the row when it is not the default. The stats strip under
  the card (speed, cache, memory, context) is hidden. On a 320 to 360 px phone dictation, the voice call and the Teams
  chip wait in the sheet.
- **Conversation**: the line under an answer is ONE line of flat 36 px icons (copy, read aloud, **five stars of 30 px**, branch, the engine's usage icon) and, at its end, **« Report » as a flag** (the slot's element is kept, and drawn over the last 36 px of the line, which the line keeps free; the form still opens under the line). The answer's clock is not drawn (the person's own message keeps its time). When the line is full the usage icon wraps rather than hides (rounds 8-9). **On a tap (2026-11-23, the owner's decision)**: in the locked phone preset (`messageActions: 'tap'`, Theme plugin) the line is hidden by default and a tap on the answer shows it, so it is drawn only when asked for, and then every button (the flag too) is a 44 px zone, the line 44 px high; the stars stay 30 x 36 (not decided yet). The person's own message follows the same rule (2026-11-24): its row (the time and the copy icon, `data-clock="start"`) is hidden until a tap on the message, one row open at a time across answers and messages. The behaviour (what a tap does and does not do, one row at a time, the animation) lives in the Kybernos plugin (`kb-msg-actions-tap`); the 44 px rules are section 5b of `mobile.css`, scoped to `html[data-kb-msg-actions="tap"]`. Read live by `scripts/check-message-actions-live.mjs`. **Cite and Edit (2026-11-24, list item 31)**: *Cite* is a 36 px icon next to the rating, in the row under an answer (slot `conversation.chat.assistant-actions`, `KbMsgCite` in `kybernos-plugin/client.js`): a tap puts the text selected when the finger went down, else the whole answer (1200 characters at most), in the composer as a quotation (`> ` before each line), after what is already written there. *Edit* is a button added to the row of the person's own message when a tap shows it (the engine draws that row and gives no slot there; only in tap mode): it puts the message text back in the composer as a draft, after any unsent draft. Both go through `kbPrefillDraft` (the draft the new-chat cards use) and never send; a message with attachments gives its text only.
- **Right bar** (the "Start" launcher, files, changes, details): a full-screen layer, with DSH's own full-screen state
  honoured.
- **Settings** is a list of pages (rows of 40 px, vertical), then, once one is picked, the page under a "back" bar
  (« ‹ Settings »): not a strip of tabs. In a page, a setting is its text, then its control under it when the text would
  be left with less than 180 px.
- **Pages** (Kybers, Workspaces, Creations, Automations, Skills, Connectors): DSH sizes its grids and toolbars for a desktop
  (330 px card columns, a toolbar of 592 px). The browser half **measures** the page and marks what does not fit
  (`data-kbmob-fit`): a card grid gets columns that fit, a toolbar that overflows (or squeezes a search field to 4 px, or a
  button's label under the next one) wraps, a strip of tabs or a segmented control slides sideways, a row of cards that is
  cut without a scroller wraps. Controls are at least 36 px. A conversation is left to DSH.
- Dialogs, menus and lists never leave the screen; on a coarse pointer, fields are 16 px and menu rows are at least
  44 px; the page draws under the notch (`viewport-fit=cover`) and the drawer, the menu button and the composer pad
  with `env(safe-area-inset-*)`.

### The look below 600 px (slice 1, 2026-11-07)

One more block at the end of `mobile.css`, behind `@media (max-width: 600px)`: 601 to 700 px keeps the layer above exactly as it is, and
deleting the block gives it back. Same pages, same content; the mockup's scale as tokens (`--kbmob-*`: type 30/24/19/17/16/14.5/12.5,
radius 28/22/16, row 52, header 56, gutter 20) over the engine's own colour tokens (`--dsw-alias-*`, which the engine declares on `<body>`: the derived colours are declared there too),
so dark, light and the theme packs keep working and the block has no colour of its own. The prefix is `--kbmob-` because the models plugin owns
`--kbm-bg` and its family. The type sizes are the sizes that show (real px: `--kbmob-tsa` is 1; it was 1.18 while the layer scaled the browser's text by 118 %).

- **Home**: the tile shelf is a slider (one row, snaps to a tile) instead of a four-column grid; the composer is one soft card.
- **Menu**: in a browser the drawer is the whole page (the engine's scrim is hidden), its entries at 54 px with 22 px icons; Workspaces, sessions, Pinned
  and the search are the engine's own and stay. In the Kybernos app the drawer is the one of « Menu C2 » below.
- **Settings**: one flat list of the engine's real pages. The core plugin keeps one group open and hides the rest; here every page shows and
  the nine group names are small labels that do nothing (no accordion).
- **Pages**: the title shares the menu button's line (a fixed 56 px band) instead of a row of its own 78 px down, with a 20 px gutter. These
  rules style `kb6-` (the page header), so they live in the core plugin next to `.kb6-headrow`, at the same 600 px; this sheet only holds the
  numbers they read.
- **Loading card** (not phone-only, `boot.css`): the engine's boot card says "HARNESS" and "Loading plugins...". Only a sheet first in
  `<head>` can change it, so it is a head row of its own (`kbmob-boot`, read from `boot.css`, no media query): the word becomes the K of the
  brand (the geometry of `kbBrandArt`, drawn in the sheet, never a file) and the hint goes. The failure card
  ("Failed to load plugins" and the names) is left as the engine draws it. The static page title and the engine's manifest name are not
  touched here (the host half and the mobile bundle own those).

### The look below 600 px, slice 2 (2026-11-07)

Same block, same rule (delete it and the layer above is back). What it adds:

- **No outlines**: a surface is told from the next by tone, space and a soft shadow, never by a 1 px line. Cards take the card tone, what sits on a card
  takes the second tone; the tile shelf and the type tiles keep their picture and get a shadow in place of their ring. (The rules are the
  ones of our own bundles, `kb6-`/`kb8-`/`kba-`/`kbnm`…; an engine surface is not named by its hashed class.)
- **44 px targets** for the menu button, the « ? » pill, the Skills toolbar buttons and the Light/Dark buttons (the glyph stays small).
- **The home's chips are in the « + » sheet**: the folder, the mode, the access chip and the BETA tag are parked, not removed (the engine's menus
  anchor to them), and the sheet lists them with their value, then « Files and commands » (the engine's own « + » menu). The composer row keeps
  « + », the model, the microphone and Send.
- **Back arrow on every page**: the corner button is the menu on the home and in a chat, and a back arrow on a page (it opens the menu the page was
  reached from). The page's one primary action (Create, Create a skill, Add an MCP server) floats at the bottom right.
- **Bottom sheets**: the engine's menus and popovers (model, « + » commands, mode, folder, account, a session's actions) rise from the bottom edge
  with a handle, over a scrim; a swipe down on one closes it. A menu that sits inside a box with its own z-index (the composer's), or a
  sticky one (DSH 0.2.2's composer seat), or an isolating one (`isolation: isolate`, the conversation's root on 0.2.2-rc.5), is lifted out of it while it is open (`data-kbmob-lift`; a sticky box is made relative meanwhile), or the scrim would cover it.
- **The composer's « + » in a chat** is the engine's own: it gives the field the focus and opens the command menu from it, so the keyboard guard
  (a composer that takes the focus by itself lets go of it) leaves the field alone for a tap on that button (the one button of the card with
  `aria-haspopup="listbox"`). On the home the « + » opens our sheet and the guard stays.
- **Layers** (contract §8): the page tells the shell how many layers are open (`layers`), closes the top one on `close-layer` and on the
  system Back (one history entry per open layer: same address, the router's own state kept, plus a marker), and sends nothing that carries text.
- **The shell's entries** (contract §1b): `KybernosCaps/<list>` in the user agent names what the shell can open: `account`, `plans`, `where` (a tap opens `kybernos://account`, `plans` or `where`) and, since C2,
  `referral` and `signout` (rows of the web's account menu, see « Menu C2 »: Account, Referral and Sign out open `kybernos://account`, `kybernos://referral`, `kybernos://signout` when the shell lists them, and keep the web's act otherwise). `plans` stays a known name; no page of ours opens it today. Where Kybernos runs is a pill under the chat title.
  No list, no entry: a plain browser or an older shell sees nothing new.

Found on a real Android phone (Chrome, 406 px, 2026-11-07), fixed in 0.4.3:

- **The menu button finds DSH's toggle by its size, in either state.** DSH's sidebar now starts with the brand button « New session » (331 px wide), and a phone has no
  `aria-keyshortcuts` to find the real toggle by, so « the first button of the sidebar » was the brand button. Only narrow buttons (56 px at most) are candidates, the highest
  first; with none, nothing is clicked. (A desktop-class browser draws the shortcut, which is why the pane runs of slice 2 never hit this: use an Android user agent to reach it.)
- **A sheet of ours lets go of the keyboard.** While the « + » (or « More actions ») sheet is open, a text field that takes the focus is blurred again, so the on-screen keyboard does not rise over the sheet.
- **A drawer the page did not open is still closed on a resize** (`settle`, at start and after a turn of the screen): that is for a drawer DSH opens by itself above its breakpoint. The menu button marks the drawer it opens
  and that one stays; one opened by a script through DSH's own toggle is not marked, so the next `resize` (Chrome's address bar moving fires one) closes it and takes its history entry back.

Asked for by the owner after looking at the real menu (« too much space between the entries », « the + next to Kaby is too small »), 0.4.4 (the pinned chat's « … » came in 0.4.5):

- **Rows of 46 px, text 17 px, gap 14 px** (they were 54 px, 19 px, 16 px: the mockup had six entries and no workspace tree; the real menu has seven entries, then Workspaces, Pinned and the
  workspace row, so the chats were pushed off the screen). Every row stays at 44 px or more. The gaps under New chat and above « Workspaces » lose a few pixels.
- **The tree's icon buttons keep their 44 × 44 hit area and grow their glyph**: 24 px for the « + » of a workspace (the last button of its row: found by its place, because a phone has no
  keyboard shortcut written on the buttons), 20 px for the other ones.
- **An empty « Pinned » block is hidden below 600 px** (it is 80 px high for a header and « No pins yet… »); it is back as soon as a chat is pinned. The core plugin writes `data-kbpin-empty` on the section
  when there is nothing pinned, so the look does not read the signature's format; wide screens keep the block.
- **A pinned chat keeps one « … » of 44 × 44 at the end of its row.** The core plugin shows a pinned row's buttons on hover only, and a phone has no hover: after the pin worked, a pinned chat could be
  neither unpinned, renamed nor archived. The look shows the row's `kbpin_more` (its menu: Unpin, Rename, Fork, Archive, drawn as a bottom sheet like the other menus) and leaves the archive and unpin buttons
  to that menu; the title leaves room for it. The drawer stays open under the menu (a pinned row is not one of the drawer's picks).
- **« Show in Finder » is not in a chat's menu on a phone** (a computer's notion; a wide screen keeps it). The menu has no attribute for it and the label changes with the system and the language, so the
  look finds it by its icon (`dsw-icon-folder-open-outline-regular`), inside the menu of a session row (`data-slot^="sidebar.workspaces.session.menu"`: the folder pickers use the same icon). If the engine
  renames that icon, the entry shows again: nothing else breaks. Copy Session ID, Pin, Rename, Fork and Archive stay.
- **A session's « … » no longer closes the drawer** (found while testing the pin): a tap on a button inside a session's row acts in place, only the row itself opens the chat. Before, the drawer closed
  under the menu and a chat could not be pinned, renamed or deleted from a phone.

Found page by page on a real Android phone (Chrome, 406 px, 2026-11-07), fixed in 0.4.6:

- **Front desk was a 56 px column at the right edge.** The phone look gave the frame ONE grid track, but DSH puts the main column in the SECOND one: it landed in an implicit `auto` track, sized to
  its content. A page with a wide content (chat, Skills, Connectors) filled the screen by luck; Front desk's narrow content got 56 px. The frame keeps its three tracks (sidebar, main, right bar) with
  the side ones at 0, which is what DSH writes itself when the drawer is shut. **And the two columns that stay in the flow are placed by the look** (`grid-area: 1 / 2` for the page, `1 / 3` for the
  right bar, by stable hooks): the first version of this fix left the placement to the engine, and in the Android app (where the engine's own `grid-area` of these columns was measured NOT in force) every
  screen was blank: the page auto-placed in the 0 px track, the empty right bar over the whole screen. The browser sandbox cannot show that by itself, so `scripts/check-phone-frame-live.mjs` plays the
  frame four ways (browser, app, app with the engine's placement switched off, Kaby mode) on Home and two global pages; it fails (0 px, right bar hit) on the three-track template without the placement.
- **The Android app's engine places less than the sandbox's** (third pass on the real phone, 2026-11-07): no `grid-area` on the frame's columns or on the Settings boxes, no `data-global-panel` mark (so no
  48 px padding on a page). The look says all three itself, so the same layout comes out whichever engine draws it: the page's own container (the parent of its `.kb6-headrow`) carries the whole
  clearance under the fixed title band (band + 4 px: the header row, its search and view buttons, no longer lies behind the band); the Settings boxes are placed by number (title and header on the first
  row, so the close cross sits on the « Settings » bar instead of a row of its own; nav; page) and, on the nav-first layout, the header is taken out of the flow at the bar's right. The composer does not
  keep a focus it took by itself on a touch screen, on Home and on a chat screen (no keyboard rising by itself): the guard lets go of it when it lands (and of one the engine gave it before the plugin
  started), unless the person tapped the field a moment before; a tap on a button of the card (Send) does not call the keyboard back. The composer's chips (access mode, activity) reach 44 px wide. A
  chat row of the drawer keeps its « … » (the session's actions) on a touch screen: the engine shows it under the pointer only, which left a long press as the one way to Pin, Rename or Archive; the row
  is found by its key (`data-row-key^="session:"`), its actions box by the engine's CSS-module name (`_rowActions`) and its button by its PLACE (a button that is the box's own child, or sits in a child that is not the quick actions), never by an icon name: engine 0.2.1, the Android app's, has no context-menu mark on the button and draws every icon as `data-icon="svg"` (round 9: a rule looking for an ellipsis icon never matched there, a titled chat showed its time and three 44 px buttons at rest), the sandbox's 0.2.2 has the mark and the icon names. The row at rest is its title and the « … »; Archive and Pin are in that menu. `check-phone-frame-live.mjs` plays an « old engine » way (nothing placed, nothing padded, the page region
  measured through `data-slot="main"`, not through the mark the old engine lacks) and a hover-only row, and checks all of this; the nav-first layout itself is not reproduced there (the sandbox's engine
  is the flat one). A headless page has no focus and fires no focus event, so the check turns focus emulation on first.
- **The Home « Cloud Computer » pill says its whole sentence** (round 5 on the real phone): the core clamps its description to two lines, and on a phone the sentence needs three (« Made at your first Telegram message that asks it to act… » ended in an ellipsis). Icon and title keep the first line, the description takes the line below, no clamp; the live check measures that the description is not cut.
- **Sweep of the global pages in the app's shape** (Connectors, Automations, Agent Teams, Skills, Creations; no `data-global-panel`, no `grid-area`, clearance 60 px), after the owner's photos of Connectors on the
  real phone: the highest text of each page sits below the 56 px band (the Connectors help card no longer starts under it); a tab row (`[data-slot="main"] [role="tablist"]`) keeps every label on one line
  and slides sideways when it is wider than the screen (« MCP servers » broke on two lines on the phone, whose font is wider than the sandbox's; the check widens the font); Connectors' secondary
  buttons (`.kbcp-btn` that is not primary, « Browse the catalog ») take the second card tone instead of looking like bare text; and the « Add an MCP server » menu has an icon on each row like
  Agent Teams' (kybernos-composio). The floating button already clears the last content at the end of each page (the core's 88 px of bottom padding): at rest it covers part of a card, as any floating
  button does, and the check pins the end-of-page case. Not reproduced: the real phone's FAB sat lower (taller screen).
- **The maintenance pages are a computer's** (`html.kb-app-android` only): in the app the engine runs inside it, so the audit of the engine's packages, the cards that read « unknown », the update check
  and the suite's update banner (« Update the suite, DSH restarts once ») are not drawn; the version line stays. A browser, a computer and Kaby's mode keep them (the live check pins both sides). Showing
  the app's own engine version instead is left to the owner: the payload does not hand it over yet.
- **The « credit used up » notice was a column of one or two words** (kybernos-cloud's `[data-kb="quota-notice"]`: text, button and cross in one row, the text left with ~80 px of 340). On a phone it
  is a block the width of the screen: text across, the button under it (44 px high), the cross in the top right corner.
- **The « Create » dropdowns of Skills and Agent Teams hung from the button's old place** (118 px wide, one word per line, on Skills; 358 px starting at x = -92 on Agent Teams) because the button floats
  at the bottom right but its menu stayed in the header. Both are bottom sheets now, like the engine's menus (same rule, handle, scrim; rows of 52 px). They are layers too: Back, a swipe down and a tap
  on the dimmed page close them. Agent Teams' menu listens to neither Escape nor a press outside it, so the page presses the button that opened it a moment after (`DROPDOWN_SEL` in `client.js`; a
  dropdown that closed by itself is not toggled back open).
- **Back from a Settings page went to the menu instead of the Settings list** (Settings > Auto Routing > Back). The page set `data-kbmob-page` on the dialog when a page was picked and the arrow of its
  title strip cleared it, but the layer logic knew only « Settings is open ». Back (the system's, the shell's `close-layer`) now clears the mark first (the list shows) and the next Back closes Settings.
- **Settings pages: no « Open configuration file »** (a computer's notion; the one action all 29 pages have, found by its slot `settings.action`), a 44 px cross, a back chevron drawn apart from its
  label at a thumb's size, more room above the first row of the list, and the « Advanced settings » summary of Auto Routing wraps under its title instead of sitting in a second column.
- **Activity log**: the table's four columns of fixed width left « What » 0 px (one letter per line). Each row is a small card: when, family and result on the first line, what it was and its tokens
  under it; session and detail stay hidden, as the log's own rule hides them under 520 px.
- **44 px targets** for what the pass found at 36 or 40 px: the card star and « Details » of Skills, the tabs of Automations and Front desk, the mode switch and the buttons of Connectors,
  « Customize », the Cloud Computer line, the engine's right-bar button (`data-sidebar-right-expand`) and the fields of a page. The home's « Choose workspace » (16 px) and « Minimal mode » (54 px) are
  parked under the hero row (opacity 0, no pointer events): not a target.
- **The floating button and the end of a page**: nothing to fix at the end of the scroll. The core plugin pads the page by 88 px, and the last item stands above the button (measured: 64 px of room
  on Skills, 36 on Automations). A fixed button covers whatever scrolls under it, as a floating button does.
- **Explainers wait behind the page's « ? »** (2026-11-08): a page leads with its list, its empty state and its controls. The animated « in three steps » cards of the Suite (Agent presets, Commands,
  Language and the others) start closed on a phone (the hub's `Intro` and the Language page ask the same media query as this sheet; « Watch the animation » in the « ? » card replays them). The plain
  paragraphs go by their `data-kb` hooks: the Agent Teams line under the title and the Marketplace « Two sources… » line (the « ? » panel carries both, `hidden` on a desktop), the Creations hint (the card already says the types combine), and the
  Automations home's line and note. The empty Automations home draws the Suite's « ? » on a phone only (help.json page `automations`); it had none because the home was the guide.
- **Small targets** (2026-11-08): the Web Search order arrows are 32 px squares side by side, the engine switches keep their 34 x 20 look with a 46 x 44 hit area, the zones of the Theme preview are at
  least 32 px (the range of « Text size », a 4 px track, is the engine's own control and is left as it is). On Commands the search field takes its own line below 520 px (its inline 150 px basis cut
  « Search for a command… » to « Search for a »).

Left out on purpose: the plan, credit and buy sheets, a « Cloud Computer » claim beyond the tile that is already there, the mockup's sample data, and the icon family
(the engine's own icons stay).

A style edit reaches the next page load without restarting DSH (the host re-reads `mobile.css` when its modification
time changes); a change to the host half (`index.js`) still needs a restart.

### Menu C2: the app's drawer, dock and account menu (2026-11-07, account menu 2026-11-08)

The owner chose « C2 » (a menu like the Claude Android app's). It is **app only** (`html.kb-app:not(.kb-kaby)`): a browser or an installed web app keeps the whole-page drawer above, and Kaby's mode has no drawer.
Everything is the engine's own tree re-ordered by CSS plus a few nodes of ours (`client.js`, « menu C2 » helpers), so a DSH update does not break it and there is no copy of a list.

- **The drawer** is 88 % of the screen wide (400 px at most), the rest is the dimmed chat (a tap closes it). Header: the Kybernos wordmark and the search icon (the engine's collapse button stays in the layout, invisible and
  inert, because `collapseButton()` finds it). Then the six destinations, in this order: Kaby (with the « new » dot), Automations, Connectors, Skills, Agent Teams, Creations; a hairline; then **one scrolling area**:
  « Workspaces » (a tap filters the chats below, a second tap clears it: `data-kbmob-filter` on the tree, `data-kbmob-picked` / `data-kbmob-on` on the group and the row; a collapsed workspace is opened once, so its chats are there to filter),
  « Pinned » (the pins section of the core plugin, hidden while empty) and « Recents » (a label drawn by CSS from `data-kbmob-recents`; chat rows are icon, one-line title and « … », no time). The engine's footer (account, plans, where, settings) is gone.
- **The dock** (`.kbmob-dock`): fixed at the foot of the open drawer over a fade, a round avatar (the account's initial) on the left and a white « + New chat » pill. The pill clicks the engine's own « New session » button.
  The avatar opens the web's account menu (below).
- **The account menu** is the web's own: the footer card of kybernos-cloud (space header, plan card, Upgrade ↗, Team settings ↗, Account, Referral, Appearance, Phone and channels, Settings, Website ↗, Help ↗, Send feedback, Sign out), the same entries in the same order, drawn as a bottom sheet.
  This replaces the app's own four-row Settings page of the first C2 build (owner decision 2026-11-08: « the UX of the web version, with a responsive layout »). Nothing of it is a copy: the card stays in the page, out of the flow and invisible
  (`visibility: hidden` on the footer slot, `visibility: visible` on the menu inside it), the avatar clicks the card's own button (`.kbfp-cardmain`), and the generic sheet rule of `mobile.css` (`[role="menu"]`: from the bottom edge, handle, scrim, swipe down, Back
  through contract §8) does the rest; rows are 46 px at least. Without the card (not signed in to the cloud plugin), the avatar opens DSH's Settings window. ↗ rows keep the web's browser act. A row that opens a page puts the drawer away
  (Appearance and the space header, which are controls, do not). **Account, Referral and Sign out** are drawn by the shell when it lists `account` / `referral` / `signout`: the page stops the web's act (capture phase), closes the menu and opens `kybernos://account|referral|signout`.
  Settings, Phone and channels and Send feedback open the web's own pages, unchanged.
  **First look on the real phone (round 6, 29636f06):** the sheet never showed and the drawer vanished. The menu was INSIDE the drawer's column (a `position: fixed` box, so a stacking context of its own, z-index 60): its own z-index 1001 only counted
  in there and the page's dim (on `<body>`, 1000) painted over it; and the layers' « lift » (it strips the z-index of a sheet's ancestors so that a composer menu can rise) took the column's 60 away, which dropped the whole drawer under Home.
  Two fixes: kybernos-cloud draws the menu on `<body>` on a phone too (it already did so for a collapsed rail: `railBox`, now also when `(max-width: 700px), (max-height: 500px) and (pointer: coarse)` matches), so no ancestor is lifted;
  and the sheet closes by its card's button, not by an Escape (an Escape reaches the engine, which closes the drawer under the sheet). The sandbox is signed out, so its live check could not see this: the way `app-signed` of the live check answers the
  cloud plugin's `/kybernos-cloud/status` as a connected account from the page itself, which draws the real card and the real menu in the real drawer's boxes, and asks what a finger hits (`elementFromPoint` on the first and last visible rows).
  Not seen yet: the native Account / Referral / Sign out rows (a `kybernos://` link would leave a headless page), the submenu of spaces (`.kbfp-sub`) over the sheet on the phone.
- **« Where Kybernos runs »** left the drawer: a pill under the chat title (« ● On this phone ˅ » or « On Kaby's computer »), drawn only when the shell lists `where` **and the connection is a cloud one** (`KybernosPlace/cloud`, where several places exist). On the phone's own connection there is one place, so the page draws no pill; the web app's own « execution environment » control in the composer is the choice there. A tap opens `kybernos://where` and the shell draws the native sheet.
- Engine traps: the engine sets `corner-shape: superellipse(1.5)` on everything, which made round things look like squircles, so the avatar, the pills and the dot say `corner-shape: round`. The engine's Settings trigger (`sidebar.settings`) is not drawn; the footer slot is the invisible holder of the account menu (the real 0.2.1 DOM of both was dumped: `kbf-root > kbfp-cardwrap > kbfp-card > button.kbfp-cardmain`).
- **First look on the real phone (round 5, engine 0.2.1-rc.2, 3 defects fixed):** (1) a chat row there holds the « … » box, then a wrapper slot (`sidebar.workspaces.session.row.action`) with Archive and Pin, and a time label before the box: Archive and Pin overflowed the 44 px box past the drawer and the « … » sat on the time. With the ellipsis there, the wrapper (0.2.2: `_rowQuickActions`) and the time (`_time`) are not drawn: Pin and Archive are in the « … » menu, and C2 rows have no time. (2) The search plugin's icon (`data-kb="search-header"`) is the Workspaces heading's first child on 0.2.1, invisible but 44 px wide: the heading stood 45 px right of the rows; it is not drawn in the app (the drawer's header has the search). (3) The chat header's bottom line crossed the pill's text: the header is 10 px taller while the pill is there (title unmoved), and the pill is aligned on the letters of the title (a text range, not the title box, which began 8 px before the word on the phone).
  A fourth one, found on the same photos: the composer's model-chip rules (`display: inline` and `flex: 1` on the spans of the chip's button) also reached the rows of the model menu, which is drawn inside the same slot, so each row's tick took half the row and the model names looked centred. The chip's rules now skip anything inside a `role="menu"`.
- **The drawer opens at its top (round 3, 2026-11-24):** the engine scrolls the active chat into view when the drawer opens, which hid « New chat », Automations and Apps under the header on the owner's phone (the list at 82 px, and at 386 px once a chat low in Recents was open). `startDrawerTop` (client.js) watches the frame's `data-sidebar-collapsed`; when the drawer goes from closed to open it puts every scrolled area of the sidebar back to 0 at 0, 80, 200, 450 and 900 ms (the engine's scroll comes a few frames late), and stops as soon as the person touches the drawer. The areas are found by their scroll (`overflow-y` auto/scroll and `scrollTop > 0`), no label is read. Checked live: a list left at 324 px while closed is at 0 at the first look after opening.
- **Pinned rows are Recents rows (round 3, 2026-11-24):** the owner found the pinned text too small (measured on the phone: `.kbpin_label` 14.8 px against 25.3 px for the Recents rows). On the full look (Complete) the title, the folder and the rename field of a pinned chat now have the size of a Recents row (15 px in a 48 px row; the field 40 px, which the phone keeps at 16 px to stop the keyboard zoom), the chevron is 16 px and the notice follows the caption size; the sizes come from `--kbmob-fs-row` (15 px divided by the phone scale, like the other sizes of the layer). Simple's 22 px / 60 px are the Theme's `drawer-large` rules (packages/kybernos-theme). The spinner slot (`.kbpin_state`) is another session's and is not touched. Checked live at 360, 390, 406 and 412 px in both modes with a faithful copy of the block's markup (the sandbox's session cannot pin).
- The live check (`scripts/check-phone-frame-live.mjs`, way `app`) pins the width, the six rows and their order, the one scrolling area, the filter, the dock, the avatar and the pill (round, not squircle), the account menu sheet (the avatar opens it, width, rows of 46 px, dimmed page, the card not drawn, Back closes it, the Settings row when signed in) and the where pill.
  Not covered there: a tap on a `kybernos://` link (a headless page would leave itself), Kaby's mode and the cloud page, a real signed-in account, the real 0.2.1 DOM.

### The « ? » of a page and its help card on a phone (2026-11-23)

The owner's phone (rc5m, Simple) showed the help card of Automations as a 44 px strip, the title and the text cut to a letter or two a line, and the « ? » on the left of its 44 px box. Measured on the real GUI at 390 px
(`scripts/check-help-panel-live.mjs`), five causes, each fixed where it lives (no screen of its own: the card is the Suite's, the fixes are CSS):
1. **The touch layer's « every dialog is a bottom sheet » rule** (`width:100%`, kybernos-theme) hit the card (`role="dialog"`), which hangs inside a wrapper as wide as its 44 px button. The card is excluded (`:not(.kbhp-pop)`), and it now states its own bounds (`max-width: 100vw - 32px`, kybernos-hub), so the phone layer's generic `max-width:100%` of a section cannot shrink it either.
2. **The pill is a flex box without `justify-content:center`**: the 44 px minimum widened the box and left the « ? » at its start. Five copies (kybernos-hub `.kbhp-btn`, the page header `.kb6-helpbtn`, Language `.kbln-help-btn`, Atlas `.kbat-help`, Call `.kbcl-hl`) now centre their glyph, and all five are 44 px and in the card tone here.
3. **Inside a Settings page the touch layer zooms by 1.14**: a card sized from the screen came out 408 px wide, off the right edge, its ✕ half out. The card is zoomed by the inverse inside it (kybernos-theme `TOUCH_ZOOM`).
4. **The chat strip's help sheet** (kybernos-kyber, phone sheet `inset-inline:16px`) lost to the inline `inset-inline-start` the Suite computes for a card that hangs from a button: the card sat 296 px left of the screen (full app). Its sides are `!important`.
5. **Targets under a thumb**: the card's ✕ (26 px) is 44 px here, in the card's corner, the title leaves it room; the article link, « Watch the animation » and a page's action are 44 px high; the card reads at 16 px.

Five more came out of a second pass with a scan of what sticks out of the screen or of the box that clips it (closed, with the card open, with the page's own guide open):
6. **The Agent Teams guide** holds two three-column tables (a first column of 118 px, a path that cannot break): the third column was cut by the card and the screen. On a phone each row is a small block, the first cell its heading, the other cells carry their column's name (`data-label`, kybernos-plugin), the header row is gone.
7. **The Language page** had a row 46 px too wide (`.kbln-lang-act{width:100%;padding-inline-start:46px}` in a content box, kybernos-language): a sideways scrollbar at the foot of the whole Settings page. `box-sizing:border-box`.
8. **The ✕ of a page's own guide** (Agent Teams 28 px, Automations 32 px) is 44 × 44 here.
9. **The providers page of Settings** (full app): its head (search, « Add provider », « … ») was 12 px too wide at 390 and 57 px at 360, a sideways scroll of the Settings page; on a phone it wraps (kybernos-models).
10. **The Theme page's folded editor**: a segmented control (Surfaces, Text, States, Brand) of 379 px in a 315 px row stuck out of the screen in Simple; it stays in its row and scrolls in its own box (kybernos-theme `.kbth-seg`). The scan opens the page's `<details>` once to see it.
What stays as it was, on purpose: the Language page's guide has no ✕ (it is an inline panel the page's own « ? » toggles, `aria-expanded`); the French card titles of a bundle's card come from the catalogue's English `titre` (a content item for the catalogue, not a phone one); the Automations tab strip at 360 px scrolls sideways inside its own box (the third tab is cut by design, no hint of it yet).

The check plays every page the phone can open (the drawer's rows, every Settings page), with an empty and a filled automation list, at 360 / 390 / 412 px, in English and French, light and dark, in Simple and in the full app, and fails on: a glyph that is not centred in a drawn icon box, a « ? » under 44 px, a card that leaves the screen, is narrower than the screen leaves, is cut by its own edge, has something of the page over it (five points are hit-tested), a ✕ that is small, outside or covered, a foot control under 44 px, a tap on the ✕ that does not close it, something that sticks out of the screen or of the box that clips it, a pane as wide as the screen that scrolls sideways (`--only <page>` replays one page). Not covered: the other `role="dialog"` popovers that hang from a button inside a small wrapper (the changes card, the footer's bell, the microphone and audio pickers, the model health card…): the touch layer's sheet rule (`width:100%`) still applies to them, which is the cause of 1 if their wrapper is narrow; this sweep did not reach them, so it is unmeasured, not known good.

### Settings on the owner's phone: 406 px, « Back to workspace » (2026-11-23)

Replayed at 406 px, device pixel ratio 3, the owner's Android user agent (`KabyMode/1 … KybernosPlace/local`), `kb-native-insets`, with and without a connected account. The Settings list shows the six pages of the
locked preset (General, Usage and Connectors are `display:none`); the nine pages the owner's rc5m build showed are the preset as it was before commit `94439098`, so that build carried older plugins.
« Back to workspace » (`.kbsb`) was 14 px text, a 15 px arrow, 40 px high: in the touch layer it is 18 px semibold, a 24 px arrow, 48 px high (`TOUCH_RULES` of kybernos-theme, with an ellipsis for a long translation).
The native gear is not the page's: the page sends `app-entry` once after `kaby-ready` and the shell decides (`docs/dev/kaby-mode-shell-contract.md`).

### Installing it on the home screen (iPhone and Android)

DSH's own manifest names the app « DeepSeek Harness », asks for `display: fullscreen` (iOS has no such mode), has one SVG
icon and no iOS tag: measured on an iPhone simulator (2026-10-24), « Add to Home Screen » gave the engine's identity.
`pwa.mjs` gives the page the product's own, through plugin seams only (no engine patch):

- **Head tags**, injected with the stylesheet (`webserver/index-inject`): the Kybernos manifest (placed before the engine's, the
  first one in the document wins), `apple-touch-icon`, `apple-mobile-web-app-capable`, the app title, a black status bar,
  and a `theme-color` for the dark and the light scheme. Every link is relative, so a DSH served under a path prefix works.
- **`GET /kybernos-mobile/pwa/<file>`**: the manifest (`name` Kybernos, `display: standalone` with a `minimal-ui` fallback,
  `start_url` and `scope` at the page root) and four PNG icons (192, 512, a maskable 512 whose K stays inside the central
  80 %, and the 180 px home-screen icon). The icons are **drawn in code** (the K of the brand mark, anti-aliased, PNG
  encoded with `zlib`, kept in memory after the first request): the repository tracks no media (`scripts/garde-depot.mjs`).
  The routes sit behind the stylesheet's Host and Origin fences.
- **Home indicator**: the drawer pads `env(safe-area-inset-bottom)` as it pads the top, so its account card stands above it in an
  installed copy (`viewport-fit=cover` is added by `client.js`).
- `KYBERNOS_MOBILE_PWA=0` turns the tags and the routes off (the layout stays).

Not covered: a real iPhone, notifications, a service worker for the main app (the phone-link PWAs have their own).

### Phone and channels (one screen)

One screen, two blocks, shown in two places (decision of 2026-10-19; the old « Remote control » entry, its popover and the duplicated panel are gone; reorganised on 2026-10-22: the remote control is walled off from Kaby, which now holds its messaging apps AND its computer):

- **A window**, from the account menu's **« Phone and channels »** entry (just before « Settings ») or from the **« Set up… »** button of Kaby's strip. It opens itself:
  `window.__KB_MOBILE__.open()` draws it in a React root of its own on `<body>` (`react-dom/client`, else `react-dom` when it still has `createRoot`; one window at a time;
  `false` when there is no root to draw in), so it depends on neither the account menu nor the footer nor the phone layout's sliding drawer (a fixed box inside that drawer sits
  off-screen). `kybernos-cloud` only offers the entry while `open` is published. Escape, the dim, the cross and any request for Settings › Servers close it; closing withdraws a
  code nobody scanned (never one a phone is waiting on). It asks for no code by itself: « Add a phone » does.
- **Settings › Phone and channels** (section id `kybernos-mobile`), the same two blocks with the animated help and the plan chip above them.
- **Left, « Remote control »** (this bundle), tagged **« Full control »**: the only thing on the screen that gives a phone control of this computer. It has **one switch**
  (`phone-remote-switch`, a `role="switch"` button), **ON by default, which means « ready to pair »**: no phone can reach the computer until one is linked (a QR code, a 4-digit check,
  the person's OK), and the card says so (« No phone is linked yet, so nothing can reach this computer »). Switched **off** it cuts every link, withdraws a pairing in progress and refuses a
  new one (`POST /kybernos-mobile/remote/enable { on }`; the host keeps the choice in `<remote dir>/settings.json`, 0600, and a restart keeps it; the linked phones stay listed, offline, and come back
  when it is turned on); the card then says « Off. No phone can connect to this computer » with a « Turn on » button, and still lists the linked phones so they can be disconnected. The switch is this computer's own: it works whenever DSH's host half answers, also while the
  server does not offer the phone link yet (the card then says, in the same box as every other state — a chip and one sentence —, that nothing can be linked for now; it is greyed only on a DSH that cannot do the phone link at all). Below: the phone link in its states
  (ready to pair, a code to scan, a phone asking for the 4-digit check, a code that ran out, a phone connected, a plan without the link) and the linked phones (when each was seen, disconnect one
  or all; no empty « Linked phones (0) » section). A chip says which state it is. When the plan does not include the link the block says « Not included in your plan » and offers the plans.
  At the foot, three short lines (the same look as Kaby's): **It does** (shows this computer's Kybernos on the phone through a relay that reads nothing), **It needs** (this computer on and online),
  **Be careful** (full control of this computer, named; only on a phone that is yours). Every gesture tells the rest of the page with a `kybernos-mobile:changed` window event (Kaby's strip listens).
- **Right, « Kaby »** (drawn by `kybernos-kyber`, which publishes `window.__KB_KYBER__.ChannelsColumn`; without that bundle the card says the Kaby module is not active), tagged **« Always asks first »**,
  in two sub-blocks: **Messaging apps** (Telegram with the real switch and pairing code, WhatsApp a beta that says « not available on this server yet » until a server announces it, WeChat and
  iMessage « soon »; « It does / Never »: a messaging app reaches Kaby only, never this computer) and **Kaby's computer** (this computer or a cloud computer, with its state; it used to be set
  only in the chat's strip).
- On the phone: scan, open the link, a 4-digit code appears; on the computer the same code and an **Allow** button.
  Nothing is served to the phone before that. From then on the phone reconnects by itself.
- Everything the person does is a gesture on the computer: a phone can never add, approve or remove a phone.
- **Two apps from the phone page** (2026-10-19, `docs/etudes/2026-10-19-deux-pwa-telecommande-et-kaby.md`): once a phone is paired, the page offers to put Kybernos on the home screen as **two apps**, « Kybernos à distance » (`/__kb/`: the whole DSH of the computer, as before) and « Kaby » (`/__kb/kaby/`: the same DSH, opened on Kaby's own conversation by `kybernos-kyber`). Two pages, two manifests (own `id`, `start_url` and `scope`), **one service worker** (it lets the whole `/__kb` shell through). Android: the browser's own install prompt behind a button, and its menu when the prompt has not fired; the other app is another page that makes its own offer. iPhone: **an app keeps its own storage, so a pairing made in Safari is lost on installing**: opened from a pairing link, the page offers to install first (« Copy the pairing link »), and the app, which the camera cannot reach, links itself by **pasting** that link (a paste field when the clipboard is refused). The offer is not made inside an app, off a touch device, or for 7 days after « Later »; an app shows up in the computer's list as « iPhone · app » or « iPhone · Kaby ». Two icons are not two rights: whichever icon opens it, a linked phone has the power of the keyboard.
- The remote only concerns the **local** DSH: a hosted session lives in the web app and a cloud computer opens from the console.

## How it works

| File | Half | Role |
|---|---|---|
| `mobile.css` | data | the whole layout, in one `@media (max-width: 700px)` block, then the look below 600 px (one more block); keyed on DSH's stable hooks (`data-slot`, `data-sidebar-collapsed`, `data-rightbar-*`, `data-shell-*`, `role`), never on its hashed class names |
| `boot.css` | data | the loading card (the K instead of the word, no hint; the failure text stays): a head row of its own, no media query, because the engine's boot card is not a phone-only thing |
| `index.js` | host | puts `mobile.css` in every index render (`webserver/index-inject`), serves it at `GET /kybernos-mobile/mobile.css`, and registers the phone link's routes behind the Host and Origin fences |
| `client.js` | browser | the menu button, the drawer taps and swipe, closing a drawer DSH left open, the "..." sheet, Settings' list and back bar, the rating star, the page measures (`fitKinds`), `viewport-fit=cover`; the « Phone and channels » screen: the window (`window.__KB_MOBILE__.Dialog`, opened from the account menu's entry) and the Settings › Phone and channels page |
| `remote-mount.mjs` | host | loaded lazily and in its own try/catch: builds the link manager from this DSH's surroundings |
| `remote-host.mjs` | host | pairing, paired phones, one outbound relay connection per phone, and the replay of a phone's requests against this DSH |
| `remote-local.mjs` | host | the DSH home, DSH's own port, and the session cookie the replay needs |
| `remote-e2e.mjs` | both | the end-to-end channel (WebCrypto only; the computer and the phone page run the same file) |
| `qr.mjs` | host | QR encoder (no dependency), checked against Chrome's decoder |
| `phone/` | phone | the page the relay's web origin serves: `index.html` and `kaby.html` (the two apps' pages), `phone.mjs`, `sw.js` (service worker), `manifest.webmanifest` and `kaby.webmanifest`, `icon.svg` and `kaby-icon.svg` (the apps' PNG icons are drawn by the server) |
| `remote-fake-relay.mjs` | tests | a stand-in for the relay and the server's `/v1/remote/*` routes (tests and live checks only) |

The full protocol, the server's contract and the security model are in [`docs/dev/mobile-remote.md`](../../docs/dev/mobile-remote.md).

- No engine patch: the seams are `webserver/index-inject`, plugin routes, the `settings.section` slot and one narrow
  seam of `kybernos-cloud` (`globalThis[Symbol.for('kybernos.cloud')]`, authenticated calls limited to `/v1/remote/` for this bundle; the
  account token never leaves `kybernos-cloud`).
- Files, under `<DSH home>/kybernos/mobile-remote/` (mode 0600): `identity.json` (this computer's long-term key, which
  the QR code carries the public half of) and `devices.json` (the paired phones' public keys) and `settings.json` (`{ v: 1, enabled }`: the screen's one switch, written only when it is switched; a damaged file reads as the default, ON). Nothing is written until
  the first pairing. No `localStorage` here; the phone page keeps its own key in the phone's IndexedDB, not extractable.

## Limits

- Only DSH's frame is adapted. A plugin's own settings page that fixes its widths keeps its desktop layout.
- The phone link needs this computer on, with DSH running: there is no queue, and a closed laptop is an offline phone.
- The page the phone loads comes from the Kybernos web host: the encryption protects from the relay and its logs, not
  from a web host that served a hostile page.
- A phone has the power of the keyboard (it can talk to the agent, under DSH's own approvals). It cannot reach the
  routes that change who can reach this computer (credentials, plugins, the server, phones), see `refusedOnPhone`, and it cannot make a write
  that asks for DSH's session cookie: the computer marks every request it replays (`x-kybernos-tunnel`) and `writeGuard` refuses the marker (`test-tunnel-routes.mjs`).
  When the phone tries one, the computer answers `403 refused_on_phone` and the phone page says so in one line (French on a French
  phone), apart from the connection veil; it goes away on a tap or after 8 seconds.
- Node 22 or later (the WebSocket client is the runtime's own).

## Tests

`test-mode.mjs` (the resolver's order over a matrix, the two copies of its text kept equal, the store, the route and its fences, the head rows), `test-mode-ui.mjs` (the seam, the segment, the sheet, the palette commands, on a fake DOM) and on the real GUI `scripts/check-mode-switch-live.mjs` (the whole switch at 406 px on a sandbox: in the app, a touch browser, a computer, the palette, French, light and dark).

`test-pwa.mjs` (the manifest, the four PNGs decoded and measured: valid chunks and CRCs, brand colours, the maskable K inside the safe circle, the head tags, the route and its fences, the mounting and a refused route), `test-phone-refusal.mjs` (the phone page, run with a fake DOM: a request the computer refuses for a phone shows one line, « This cannot be done from the phone — do it on the computer. »),
`test-phone-apps.mjs` (the two manifests, the two pages, the strings, the service worker both apps share), `test-host.mjs` (the row, the routes and their fences, the stylesheet's promises), `test-client.mjs` (the contract, the
tap and swipe decisions, the sheet, the page measures, Settings), `test-layers.mjs` (the user agent's list, the layers, the history, the swipe, the messages to and from the shell), `test-style.mjs` (the look's promises), `test-remote-ui.mjs` (the screen's states, the window, a failed poll), `test-help.mjs`, `test-remote-e2e.mjs` (the handshake and its attacks), `test-remote-host.mjs` (a real pairing,
replay and revocation through a stand-in relay and a stand-in DSH), `test-qr.mjs`, `test-dsh-home.mjs`, `test-help-card-phone.mjs` (the five rules above, as source); and on the real
GUI `scripts/check-mobile-live.mjs` (the layout, a 390 px phone emulated in a sandbox DSH), `scripts/check-mobile-visual.mjs`
(seven devices, dark and light, screenshots and measures on the real DOM with the working tree's stylesheet and
client), `scripts/check-mobile-tour.mjs` (a tour of every screen, a page of the sidebar, Settings, the menus: sideways
scroll, a control that leaves the screen or is cut by its box, targets under 36 px, text under 11 px; `--device WxH`,
`--light`, `--deployed`, `--mac`, `--shots <dir>`; an Android phone by default: it also taps a page row, taps the dimmed
chat and swipes, and the drawer must go each time), `scripts/check-mobile-remote-pages.mjs` (a paired Android phone through
the stand-in relay with a slow uplink: the drawer, the Skills page, a restart of the computer's DSH while the phone is open)
and
`scripts/check-mobile-remote-live.mjs` (the QR code decoded by Chrome, a second browser as the phone, approval,
revocation, a plan without the feature).

On the real GUI, `scripts/check-phone-apps-live.mjs` plays the two apps in a sandbox DSH (an Android phone: the offer, the browser's prompt, Kaby's page resuming the same pairing and opening Kaby's chat; an iPhone: install first, an app pasting the link, revoked), and `scripts/check-phone-channels-live.mjs` plays the screen in a sandbox DSH (the account and the doors faked): the menu entry, both columns in every state, light and dark, a 390 px phone, closing, and the Settings page.
