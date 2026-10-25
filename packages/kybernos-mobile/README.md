# `@local/kybernos-mobile`

DSH on a phone, in two parts that do not depend on each other (and a third that only exists inside the Kybernos app, below):

1. **The layout** (every account, every plan): the DSH shell becomes usable below 700 px.
2. **The phone link**: a QR code on the computer links a phone to it, through the Kybernos relay, end to end encrypted.
   The phone then runs the computer's own DSH page. Whether an account has it is the server's plan (the feature `remote`,
   in the Free plan too since 2026-10-15); the plugin only shows what the server answers.

A failure in the second part never touches the first, and neither can stop DSH from starting.

## Inside the Kybernos app

The Kybernos phone app (`mobile/app`) runs the engine ON the phone and shows this same interface in a WebView, whose user agent ends with `KybernosHost/<version> (ios|android)`. There the layout above is exactly what makes the interface usable (the app's payload carries this bundle for that), and the phone link has no meaning: the phone is the device. So, and only there:

- the host half mounts no link routes and starts no relay (it recognises the app by the platform of the embedded engine, `ios` or `android`);
- the browser half registers a Settings page called « The Kybernos app » (in the same place of the list, under Devices & cloud) instead of « Phone and channels »: the model key (opens the app's secure key screen through `kybernos://settings`), the engine log (`kybernos://log`), and what a phone changes for automations (they run while the app is open or was just used; a suspended app runs what came due as soon as you come back; for a fixed time with the phone locked, use a cloud computer);
- `window.__KB_APP__ = { version, platform, appVersion, openSettings, openLog }` is there for the other bundles, `<html>` gets the classes `kb-app` and `kb-app-ios` / `kb-app-android`, and the app is told once (`ReactNativeWebView.postMessage`, `{ kybernos: 'app-entry' }`) that the interface has its entry, so it drops the small gear button it shows until then;
- the phone link window (`window.__KB_MOBILE__`) is not published, so the account menu and Kaby's strip do not offer it.
- store rules (`mobile/STORES.md` items 1, 5, 6): under `html.kb-app` the controls that buy a plan, create an account or add a plugin are hidden by their `data-kb` hooks (`STORE_HIDDEN` in `client.js`; the test checks every hook still exists in the bundle that draws it). The desktop and the browser keep them.
- a « Report » link under each finished answer (slot `conversation.chat.turnTail`, id `kybernos-mobile-report`): reason, optional comment, optional answer text (ticked by the person, editable). It saves the report in the core feedback box, then sends it with the signed-in account; signed out or offline, it offers an e-mail to the product's address. Nothing is added in a browser.

In a browser none of this exists: the user agent is not the app's, and nothing above runs.

## What the user sees

### The layout (a phone only)

The same app, the same organisation: only the layout changes with the width. "A phone" is a viewport at most 700 px
wide, **or** a touch device lying down (at most 500 px high with a coarse pointer: a phone in landscape is 844 px wide and
used to get the desktop shell). Above that nothing changes.

Measured on DSH 0.2.1-alpha.2 at 390 px, before this layout: the sidebar left a permanent rail and squeezed the chat to a
sliver once opened, the title collapsed to 0 px behind eight header buttons, the composer was two rows of 28 px targets
with the model name hidden, the right bar never appeared (DSH stacks it under the chat at 0 px high), and the page
drew under the iPhone's home indicator.

- **Text is 18 % larger** (`text-size-adjust: 118%`, what Android's and iOS's "font size" setting use): DSH draws a lot
  of its text at 10 to 12 px, in `px`, which no `rem` trick reaches. Boxes keep their size, text grows.
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
- **Conversation**: the rating card under an answer is one star (44 px); the first tap opens the five.
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

A style edit reaches the next page load without restarting DSH (the host re-reads `mobile.css` when its modification
time changes); a change to the host half (`index.js`) still needs a restart.

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
| `mobile.css` | data | the whole layout, in one `@media (max-width: 700px)` block; keyed on DSH's stable hooks (`data-slot`, `data-sidebar-collapsed`, `data-rightbar-*`, `data-shell-*`, `role`), never on its hashed class names |
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
  seam of `kybernos-cloud` (`globalThis[Symbol.for('kybernos.cloud')]`, authenticated calls limited to `/v1/remote/`; the
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
  routes that change who can reach this computer (credentials, plugins, the server, phones), see `refusedOnPhone`.
  When the phone tries one, the computer answers `403 refused_on_phone` and the phone page says so in one line (French on a French
  phone), apart from the connection veil; it goes away on a tap or after 8 seconds.
- Node 22 or later (the WebSocket client is the runtime's own).

## Tests

`test-phone-refusal.mjs` (the phone page, run with a fake DOM: a request the computer refuses for a phone shows one line, « This cannot be done from the phone — do it on the computer. »),
`test-phone-apps.mjs` (the two manifests, the two pages, the strings, the service worker both apps share), `test-host.mjs` (the row, the routes and their fences, the stylesheet's promises), `test-client.mjs` (the contract, the
tap and swipe decisions, the sheet, the page measures, Settings), `test-remote-ui.mjs` (the screen's states, the window, a failed poll), `test-help.mjs`, `test-remote-e2e.mjs` (the handshake and its attacks), `test-remote-host.mjs` (a real pairing,
replay and revocation through a stand-in relay and a stand-in DSH), `test-qr.mjs`, `test-dsh-home.mjs`; and on the real
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
