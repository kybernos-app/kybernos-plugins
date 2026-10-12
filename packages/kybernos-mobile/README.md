# `@local/kybernos-mobile`

DSH on a phone, in two parts that do not depend on each other:

1. **The layout** (every account, every plan): the DSH shell becomes usable below 700 px.
2. **The phone link** (paid plans): a QR code on the computer links a phone to it, through the Kybernos relay, end to end
   encrypted. The phone then runs the computer's own DSH page.

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

- The conversation takes the whole screen. A **menu button** (44 px) sits in the top-left corner and opens the sidebar
  as a **drawer** over the chat: same entries in the same order (New chat, Kybers, Workspaces, Creations, Automations,
  Skills, Connectors, Automation tasks, Pinned, the folders and their sessions, the account card), 48 px rows, 16 px text.
  A tap on the dimmed chat closes it, and so does picking a session or a page. A drawer DSH left open on a phone in
  landscape is closed once at start and after a turn of the screen, unless the person opened it.
- **Header**: the title and the page-level actions (Teams, voice call, "More actions", right bar). Agent Team, share,
  chat ID, video call, call settings and "open in Finder" are hidden here for now (they stay on the computer).
- **Composer**: the field, then one row: add, **model (the name is readable)**, access, dictate, send. The "/" button,
  the artifact button and the input-device list are hidden (type "/" in the field; the "+" menu has the commands);
  the execution environment only shows when it is not the default. The stats strip under the card (speed, cache,
  memory, context) is hidden. On a 320 to 360 px phone dictation and the voice call wait.
- **Conversation**: the rating card under every answer is hidden.
- **Right bar** (the "Start" launcher, files, changes, details): a full-screen layer, with DSH's own full-screen state
  honoured.
- **Settings**: the page list becomes a scrolling strip under the search box, and the page uses the full width.
- Dialogs, menus and lists never leave the screen; on a coarse pointer, fields are 16 px and menu rows are at least
  44 px; the page draws under the notch (`viewport-fit=cover`) and the drawer, the menu button and the composer pad
  with `env(safe-area-inset-*)`.

Not done yet (planned, see the mockup): the header's hidden actions in the "..." menu, the Chat / Journal / Trajectory
tabs as a dropdown under the title, the execution environment and "/" in the "+" menu, rating behind one star.

### The phone link

- **The sidebar's phone button** opens a panel with the QR code (it used to show a preview). With no paid plan the panel
  says « Included in paid plans » and offers the plans.
- **Settings › Mobile** lists the paired phones, shows when each was seen, and revokes one (or all).
- On the phone: scan, open the link, a 4-digit code appears; on the computer the same code and an **Allow** button.
  Nothing is served to the phone before that. From then on the phone reconnects by itself.
- Everything the person does is a gesture on the computer: a phone can never add, approve or remove a phone.

## How it works

| File | Half | Role |
|---|---|---|
| `mobile.css` | data | the whole layout, in one `@media (max-width: 700px)` block; keyed on DSH's stable hooks (`data-slot`, `data-sidebar-collapsed`, `data-rightbar-*`, `data-shell-*`, `role`), never on its hashed class names |
| `index.js` | host | puts `mobile.css` in every index render (`webserver/index-inject`), serves it at `GET /kybernos-mobile/mobile.css`, and registers the phone link's routes behind the Host and Origin fences |
| `client.js` | browser | the menu button, the drawer taps, closing a drawer DSH left open, `viewport-fit=cover`; the phone panel (`window.__KB_MOBILE__.Panel`, shown by the sidebar's phone button) and the Settings › Mobile page |
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
- Node 22 or later (the WebSocket client is the runtime's own).

## Tests

`test-host.mjs` (the row, the routes and their fences), `test-client.mjs` (the contract, the tap decisions, the
stylesheet's rules), `test-remote-e2e.mjs` (the handshake and its attacks), `test-remote-host.mjs` (a real pairing,
replay and revocation through a stand-in relay and a stand-in DSH), `test-qr.mjs`, `test-dsh-home.mjs`; and on the real
GUI `scripts/check-mobile-live.mjs` (the layout, a 390 px phone emulated in a sandbox DSH), `scripts/check-mobile-visual.mjs`
(seven devices, dark and light, screenshots and measures on the real DOM with the working tree's stylesheet) and
`scripts/check-mobile-remote-live.mjs` (the QR code decoded by Chrome, a second browser as the phone, approval,
revocation, a plan without the feature).
