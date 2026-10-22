# `@local/kybernos-mobile`

DSH on a phone, in two parts that do not depend on each other:

1. **The layout** (every account, every plan): the DSH shell becomes usable below 700 px.
2. **The phone link**: a QR code on the computer links a phone to it, through the Kybernos relay, end to end encrypted.
   The phone then runs the computer's own DSH page. Whether an account has it is the server's plan (the feature `remote`,
   in the Free plan too since 2026-10-15); the plugin only shows what the server answers.

A failure in the second part never touches the first, and neither can stop DSH from starting.

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

### The phone link

- **The account menu's « Remote control » entry** (bottom of the sidebar) opens a panel with the QR code (it used to show a preview), and a « ? How it works » button
  on its title row (the same card as on Settings › Remote Control: `help.json`). When the account's plan does not include
  the phone link the panel says « Not included in your plan » and offers the plans.
- **Settings › Remote Control** lists the paired phones, shows when each was seen, and revokes one (or all).
- On the phone: scan, open the link, a 4-digit code appears; on the computer the same code and an **Allow** button.
  Nothing is served to the phone before that. From then on the phone reconnects by itself.
- Everything the person does is a gesture on the computer: a phone can never add, approve or remove a phone.

## How it works

| File | Half | Role |
|---|---|---|
| `mobile.css` | data | the whole layout, in one `@media (max-width: 700px)` block; keyed on DSH's stable hooks (`data-slot`, `data-sidebar-collapsed`, `data-rightbar-*`, `data-shell-*`, `role`), never on its hashed class names |
| `index.js` | host | puts `mobile.css` in every index render (`webserver/index-inject`), serves it at `GET /kybernos-mobile/mobile.css`, and registers the phone link's routes behind the Host and Origin fences |
| `client.js` | browser | the menu button, the drawer taps and swipe, closing a drawer DSH left open, the "..." sheet, Settings' list and back bar, the rating star, the page measures (`fitKinds`), `viewport-fit=cover`; the phone panel (`window.__KB_MOBILE__.Panel`, opened from the account menu's « Remote control » entry) and the Settings › Remote Control page |
| `remote-mount.mjs` | host | loaded lazily and in its own try/catch: builds the link manager from this DSH's surroundings |
| `remote-host.mjs` | host | pairing, paired phones, one outbound relay connection per phone, and the replay of a phone's requests against this DSH |
| `remote-local.mjs` | host | the DSH home, DSH's own port, and the session cookie the replay needs |
| `remote-e2e.mjs` | both | the end-to-end channel (WebCrypto only; the computer and the phone page run the same file) |
| `qr.mjs` | host | QR encoder (no dependency), checked against Chrome's decoder |
| `phone/` | phone | the page the relay's web origin serves: `index.html`, `phone.mjs`, `sw.js` (service worker), `manifest.webmanifest`, `icon.svg` |
| `remote-fake-relay.mjs` | tests | a stand-in for the relay and the server's `/v1/remote/*` routes (tests and live checks only) |

The full protocol, the server's contract and the security model are in [`docs/dev/mobile-remote.md`](../../docs/dev/mobile-remote.md).

- No engine patch: the seams are `webserver/index-inject`, plugin routes, the `settings.section` slot and one narrow
  seam of `kybernos-cloud` (`globalThis[Symbol.for('kybernos.cloud')]`, authenticated calls limited to `/v1/remote/`; the
  account token never leaves `kybernos-cloud`).
- Files, under `<DSH home>/kybernos/mobile-remote/` (mode 0600): `identity.json` (this computer's long-term key, which
  the QR code carries the public half of) and `devices.json` (the paired phones' public keys). Nothing is written until
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
`test-host.mjs` (the row, the routes and their fences, the stylesheet's promises), `test-client.mjs` (the contract, the
tap and swipe decisions, the sheet, the page measures, Settings), `test-remote-e2e.mjs` (the handshake and its attacks), `test-remote-host.mjs` (a real pairing,
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
