# kybernos-kyber

**Kaby**, the person's own assistant (ADR 0053 of kybernos-server): a real DSH conversation, the doors it answers from, and the computer it
works on.

- **The conversation is DSH's own.** The menu row **Kaby** opens a normal DSH chat (DSH's composer, rendering and tools), made the first
  time in a workspace of its own (`<DSH home>/kybernos/kyby`, so « New chat » never takes it back) and remembered by the host
  (`<DSH home>/kybernos-kyby.json`). Its brain is DSH's agent on this machine, with the account's memory; for that chat only the host adds
  Kaby's identity to the system prompt (`kyby-native.mjs` in kybernos-cloud). Each finished turn is also written on the person's thread on
  the server, and the last words said there (Telegram's) are told back in the prompt: one assistant, one memory, one conversation, two
  bodies (this machine here, its cloud computer on Telegram). A server with no Kaby thread is simply left alone.
- **The phone's Kaby app opens on it.** DSH has no address for a conversation (the URL stays `/`), so the phone page's second app (`/__kb/kaby/`,
  `kybernos-mobile`) is found from inside: DSH runs in a frame of that page, on its origin, and `window.parent.location.pathname` says which
  app it is in. In `/__kb/kaby/`, once DSH lists its sessions and workspaces (its own startup restoration has gone first, so this is the later
  navigation), the bundle calls the menu row's `openChat()`: the chat is made the first time, then opened. Anywhere else the bridge does nothing. It is one effect of `apply` and never throws.
- **It asks before it acts.** The chat is made in DSH's own `workspace-write` mode (`/permission workspace-write`, applied once, right after it is made): DSH asks in its own approval card before a command that leaves its folder or a tool that changes something. The profile's default is full access, so without this the chat asked nothing. What the person picks later in the composer stays theirs, and a Kaby chat that already exists is not changed. Measured in a sandbox DSH: the new chat opens on « Workspace Write », the ordinary new chat on « Full access ».
- **Nothing else sits above Kaby's composer.** The new-chat cards and the templates row (Build / Create / Cloud Computer, Slides… Dashboard) are
  not drawn in that chat: the Kaby bundle tells the window (`kb-kyby-session`) the moment the chat that is Kaby's becomes known, because on a page
  load the cards are drawn before it has read the pointer.
- **The strip** (in the dock above that chat's composer and above no other's) is **ONE line** since 2026-10-22: Kaby's name, **three chips** that say how things stand — the **remote control** (« ready »,
  « 1 phone », « off », « not offered yet »; read from kybernos-mobile's own `GET /kybernos-mobile/remote/status`, absent when this DSH has no phone link), **Telegram** (amber while it can be connected and is
  not yet) and **the computer** (« This computer · Ready », or « Home · Asleep ») — then one button, **« Set up… »** (`window.__KB_MOBILE__.open()`, there only while that bundle publishes `open`:
  never a dead one) and the Suite's **« ? How it works »** pill (`window.__KB_HELP__`, this bundle's `help.json`; its card opens on the side that has room, a sheet at the foot of the screen on a phone).
  A chip opens a small list of the same three lines in words, each with one button to the screen that sets it up (Escape and a click elsewhere close it). Nothing opens by itself, nothing is
  folded, nothing is remembered: there is no paragraph and no tile in the chat any more (the explanation lives on the screen the button opens). In the dock it is as wide as the composer's card and centred like it (the engine's own `--dsh-composer-card-max-width` and `--dsh-composer-side-clearance`, inherited; the full
  width where an engine has none), with the same 28 px radius; on a narrow window the line wraps (about 800 px is where it fits). **Three states of Telegram's door**, told by the host (`GET /kybernos-cloud/kyber`:
  `telegram`, `pairing`, `server`): a **bot there**; **no bot on this server** (`configured` or `enabled` false); a **server too old** for the pairing routes (`pairing: 'unsupported'`: a 404 on
  `/v1/me/telegram` or `/v1/me/kyby`, the routes of kybernos-server#230). No bot AND too old reads « no bot » (the answer that tells where to go). A host that says nothing claims nothing. A pairing
  the server answers 404 to with none of our codes is `unsupported`. The store reads the phone link again with the rest (every 30 s, after a gesture of kybernos-mobile through its
  `kybernos-mobile:changed` window event, and while a computer settles).
- **Kaby's computer** (a sub-block of the block below, `ComputerBlock`): where Kaby works, always a real `<select>`. **This computer** (the machine that runs Kybernos) is the first entry:
  it needs no account and no server, so it is offered signed out and when the server cannot be read, choosing it calls nobody, and the
  choice is remembered by the browser (`kybernos-kyber.where`). Next to it, the cloud computers of the account (the chosen one is kept
  by the server through `POST /kybernos-cloud/kyby/computer` and used by Telegram too). With no choice made, the cloud computer is shown
  when one exists already, else this one. For the cloud one: its state (awake, asleep, **setting up**) and, on a plan that allows it,
  wake / sleep / open. Every person has one, made at the first request that needs one: until then it is « on request »; once made,
  « Setting up a machine dedicated to you » turns into « Asleep » by itself (the page reads again every few seconds while a computer is
  being made, woken or put to sleep). On the Free plan the server says `manual_control: false`: no wake button, the short note and an
  upgrade button (the footer's Upgrade dialog through `window.__KB_UPGRADE__`, else the plan page). The server has no way to name this
  computer yet (`PUT /v1/me/kyby/computer` takes a cloud computer's id): the local choice is Kaby's chat here, which already works on this
  machine; Telegram keeps using the cloud computer.
- The same three lines are a tab of the right-hand panel (with « Manage in my account »), and the page the new-chat card opens (what Kaby is, the way into the chat, the strip).
- **The right-hand block of « Phone and channels »** (`window.__KB_KYBER__.ChannelsColumn`, a component; `window.__KB_KYBER__.name` is the assistant's name). `kybernos-mobile`
  draws that screen (a window it opens itself, from the account menu's entry or from the strip's button, and Settings › Phone and channels) and asks this bundle for the block:
  **« Kaby »**, tagged « Always asks first », with one sentence (your assistant: it answers you on messaging apps and works on a computer), then two sub-blocks. **Messaging apps**: one row each,
  then « It does » (Kaby answers there, even with this computer off; linked apps share one conversation and one memory) and « Never » (a messaging app never controls this computer: Kaby asks for your OK
  first); then **Kaby's computer** (above). The rows are: **Telegram** (its **switch** — turning it on asks for a code, never when the window opens, turning it off cancels a code in flight or, for a connected chat, asks before
  disconnecting — the **Switch server** button when the server has no bot or is too old and the registry names another server (`server.can_switch`: it sends the
  `kybernos-cloud:servers` window event the footer answers by opening Settings › Servers), and the **code panel** drawn right under the row: the code (QR, three steps,
  « Open Telegram », the time left, « Cancel », and « no camera or no app? »: the same token as a command to write to the bot by hand, `/start pair_<token>`, with a copy
  button; it never leaves DSH for the console; and « In the Telegram app on this computer », a `tg://resolve?domain=<bot>&start=pair_<token>` link that opens the desktop app without the t.me page in between), then who Telegram says it is while the person confirms there; expired, refused, « already another account's », « made by the bot »
  and « too many tries » are its own cards; and the question before disconnecting), **WhatsApp** (a *Beta* chip, the beta bridge of ADR 0053 § 13.8: one number that Kybernos owns, linked to the server by a separate service. The row is
  « Not available on this server yet » while the host's `whatsapp` object is missing or off, « not reachable » while the server has the door but no bridge is open (`available: false`),
  and otherwise has the same switch and the same panel as Telegram's, on WhatsApp's own routes: the code is the number's `wa.me` link with the pairing message already typed (QR, three
  steps — scan, send the typed message, answer **1** to Kaby's question — « Open WhatsApp », the time left, and « no camera or no app? »: the message `pair_<token>` to write by hand to the
  number); connected, the row says who and that Kaby answers within 24 hours of the person's message — WhatsApp's own rule —, and the switch asks before it disconnects. One state per door:
  `state.wa` holds WhatsApp's pairing, `state` Telegram's, and `slotOf(channel)` picks one), **WeChat** and **iMessage** (« Soon »; iMessage « Mac only »). The three later rows keep an off, greyed switch. The strip's list shows the same pairing as a state (one store: a code
  started in the window reads « Code to scan » on the list's Telegram row).

**When nothing arrives (2026-10-20, measured on the dev tier).** Two real phone rounds left the code `waiting` until it expired and no Start ever reached the server (the server logs every request, the bot's username is the one of its token, and Telegram's `getWebhookInfo` showed the right URL, no error and nothing pending: the transport was fine). On a bot the person already used, the deep link `?start=pair_…` only opens the chat; the Start (or **Restart**) button must still be pressed, and Telegram does not document what its clients do (the page cannot detect it). So: step 2 says « tap Start (or Restart if you have used this bot before) »; a code that has waited 20 s with no Start (`pairingFace(...).stuck`) shows « Nothing arrived? Telegram may only have opened the chat… tap Start (or Restart)… Otherwise send it this message » with the command `/start pair_<token>` already open under it and its copy button; and a code that runs out while the page is open and in view is **cancelled and replaced by a new one by itself, three times at most** (`PAIR_RENEWALS`, so about 20 minutes in all; each poll checks the clock, and in the instant between the expiry and the replacement the code still reads as waiting at 0:00, never « expired »). A scanned code is never replaced under the person's hand, a hidden page makes no code, the person's own press of the switch or of « New code » starts the count over, and after the third renewal the expired card with its button stays. The code's life (5 minutes) is the server's (ADR 0053 § 13.6): 10 minutes would suit a scan-then-Start on a phone better, and is the one change to ask of the server.

The bundle talks only to `kybernos-cloud`'s routes (`/kybernos-cloud/kyber`, `/telegram/pairing[...]`,
`/telegram/unlink`, `/whatsapp/pairing[...]`, `/whatsapp/unlink`, `/kyby/computer`, `/kyby/native[/set]`, `/computer/*`, `/console/link`), which add the account's token; the QR is computed there.
No engine patch. The assistant's name is one constant (`NAME`) here and the label `kbui.kyber` in kybernos-plugin.

Tests, without DSH: `node packages/kybernos-kyber/test-client.mjs` (the model, and the real views rendered with a stub React, with `fetch` and timers recorded),
`node packages/kybernos-kyber/test-host.mjs`, and the host half in
`node packages/kybernos-cloud/test-kyby.mjs` and `test-kyby-native.mjs`. In a real GUI (the sandbox instance, the account's answers
faked): `source scripts/sandbox/env.sh && node scripts/check-kyby-live.mjs [--shots <dir>]`.
Against a REAL server, with Telegram played by HTTP (nothing on this side faked; the server's Telegram is a small HTTP server of ours): start
`node scripts/telegram-live.ts --serve <file.json>` in kybernos-server, then
`source scripts/sandbox/env.sh && node scripts/check-kyby-http.mjs <file.json> [--shots <dir>]` here. The page's switch asks for the code, the script
posts the webhook updates Telegram would post, and the page follows by itself (scanned, connected, disconnected); the server is asked who is linked.
