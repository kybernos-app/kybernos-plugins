# kybernos-kyber

**Kaby**, the person's own assistant (ADR 0053 of kybernos-server): a real DSH conversation, the doors it answers from, and the computer it
works on.

- **The conversation is DSH's own.** The menu row **Kaby** opens a normal DSH chat (DSH's composer, rendering and tools), made the first
  time in a workspace of its own (`<DSH home>/kybernos/kyby`, so « New chat » never takes it back) and remembered by the host
  (`<DSH home>/kybernos-kyby.json`). Its brain is DSH's agent on this machine, with the account's memory; for that chat only the host adds
  Kaby's identity to the system prompt (`kyby-native.mjs` in kybernos-cloud). Each finished turn is also written on the person's thread on
  the server, and the last words said there (Telegram's) are told back in the prompt: one assistant, one memory, one conversation, two
  bodies (this machine here, its cloud computer on Telegram). A server with no Kaby thread is simply left alone.
- **It asks before it acts.** The chat is made in DSH's own `workspace-write` mode (`/permission workspace-write`, applied once, right after it is made): DSH asks in its own approval card before a command that leaves its folder or a tool that changes something. The profile's default is full access, so without this the chat asked nothing. What the person picks later in the composer stays theirs, and a Kaby chat that already exists is not changed. Measured in a sandbox DSH: the new chat opens on « Workspace Write », the ordinary new chat on « Full access ».
- **Nothing else sits above Kaby's composer.** The new-chat cards and the templates row (Build / Create / Cloud Computer, Slides… Dashboard) are
  not drawn in that chat: the Kaby bundle tells the window (`kb-kyby-session`) the moment the chat that is Kaby's becomes known, because on a page
  load the cards are drawn before it has read the pointer.
- **The strip** (collapsible, in the dock above that chat's composer and above no other's) is **two equal tiles** and, under them, one
  panel that exists only while Telegram needs something. It is open while Telegram is not connected; once it is, or when the server has
  no Telegram bot, it is folded to its header (the name, and two chips: Telegram and the computer). The person's choice wins, and is
  remembered. Nothing above the tiles files the computer under « Channels ». In the dock it lines up with the composer's card (same left and right edge, same 28 px radius; the tiles and the panel have the radius that nests in it, 16 px).
  - **What Kaby is** (open card only): one short paragraph above the tiles, the owner's picture (« like a phone with a remote control:
    it works on your desktop »), and the Suite's **« ? How it works »** pill (`window.__KB_HELP__`, this bundle's `help.json`) beside the
    fold button. Each tile has **one help line under its title**: the channels' says what « Soon » means, the computer's what « On
    request » means. The pill's card opens on the side that has room (a sheet at the foot of the screen on a phone).
  - **Channels tile**: Telegram, WhatsApp and WeChat, one row each, with their marks. Telegram has a **switch**: turning it on asks for a
    code (never when the strip opens), turning it off cancels a code in flight or, for a connected chat, asks before disconnecting.
    WhatsApp and WeChat say « Soon » and offer nothing. The person may turn on several, as they come.
    **Three states of Telegram's door**, told by the host (`GET /kybernos-cloud/kyber`: `telegram`, `pairing`, `server`): a **bot there** (the switch works); **no bot on this
    server** (`configured` or `enabled` false); a **server too old** for the pairing routes (`pairing: 'unsupported'`: a 404 on `/v1/me/telegram` or `/v1/me/kyby`, the routes of
    kybernos-server#230). Each of the last two keeps the switch greyed and says on the row, in one sentence, what is so and what to do (« This server has no Telegram bot. Switch to
    a server that has one, such as Kybernos Cloud. » / « This server does not support linking Telegram yet. »), with a **Switch server** button when the registry names another
    server (`server.can_switch`, the footer's helper): it sends the `kybernos-cloud:servers` window event the footer answers by opening Settings › Servers. No bot AND too old reads
    « no bot » (the answer that tells where to go). With such a way out the strip opens by itself; the person's fold still wins. A host that says nothing claims nothing. A pairing
    the server answers 404 to with none of our codes is `unsupported` (a panel, never a silent failure).
  - **Computer tile**: where Kaby works, always a real `<select>`. **This computer** (the machine that runs Kybernos) is the first entry:
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
  - **The panel under the tiles**: the code (QR, three steps, « Open Telegram », the time left, « Cancel », and « no camera or no app? »: the same token as a
    command to write to the bot by hand, `/start pair_<token>`, with a copy button; it never leaves DSH for the console), then who Telegram says it is
    while the person confirms there; expired, refused, « already another account's », « made by the bot » and « too many tries » are
    its own cards; and the question before disconnecting. The tiles keep their height while it is open.
- The same panel is a tab of the right-hand panel, and the page the new-chat card opens (what Kaby is, the way into the chat).
- **The right-hand column of « Phone and channels »** (`window.__KB_KYBER__.ChannelsColumn`, a component; `window.__KB_KYBER__.name` is the assistant's name). `kybernos-mobile`
  draws that screen (the account menu's window and Settings › Phone and channels) and asks this bundle for the column: **« Talk to Kaby on a messaging app »**, a sentence that says
  only Kaby answers, even with the computer off, and that a messaging app never gives control of the computer, then one row each: **Telegram** (the same row, switch and code
  panel as the strip's, drawn right under the row: one pairing is one pairing wherever it is looked at), **WhatsApp** (a *Beta* chip and « Not available on this server yet »:
  no server has the door; a host that forwards a `whatsapp` object like `telegram` — `configured` and `enabled` — changes the line to « This server offers it », and the row stays
  inert because linking is not built here), **WeChat** and **iMessage** (« Soon »; iMessage « Mac only »). The three later rows keep an off, greyed switch. The strip above the composer
  is untouched: reducing it to the states is a follow-up.

The bundle talks only to `kybernos-cloud`'s routes (`/kybernos-cloud/kyber`, `/telegram/pairing[...]`,
`/telegram/unlink`, `/kyby/computer`, `/kyby/native[/set]`, `/computer/*`, `/console/link`), which add the account's token; the QR is computed there.
No engine patch. The assistant's name is one constant (`NAME`) here and the label `kbui.kyber` in kybernos-plugin.

Tests, without DSH: `node packages/kybernos-kyber/test-client.mjs` (the model, and the real views rendered with a stub React, with `fetch` and timers recorded),
`node packages/kybernos-kyber/test-host.mjs`, and the host half in
`node packages/kybernos-cloud/test-kyby.mjs` and `test-kyby-native.mjs`. In a real GUI (the sandbox instance, the account's answers
faked): `source scripts/sandbox/env.sh && node scripts/check-kyby-live.mjs [--shots <dir>]`.
Against a REAL server, with Telegram played by HTTP (nothing on this side faked; the server's Telegram is a small HTTP server of ours): start
`node scripts/telegram-live.ts --serve <file.json>` in kybernos-server, then
`source scripts/sandbox/env.sh && node scripts/check-kyby-http.mjs <file.json> [--shots <dir>]` here. The page's switch asks for the code, the script
posts the webhook updates Telegram would post, and the page follows by itself (scanned, connected, disconnected); the server is asked who is linked.
