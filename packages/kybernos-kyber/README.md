# kybernos-kyber

**Kaby**, the person's own assistant (ADR 0053 of kybernos-server): a real DSH conversation, the doors it answers from, and the computer it
works on.

- **The conversation is DSH's own.** The menu row **Kaby** opens a normal DSH chat (DSH's composer, rendering and tools), made the first
  time in a workspace of its own (`<DSH home>/kybernos/kyby`, so « New chat » never takes it back) and remembered by the host
  (`<DSH home>/kybernos-kyby.json`). Its brain is DSH's agent on this machine, with the account's memory; for that chat only the host adds
  Kaby's identity to the system prompt (`kyby-native.mjs` in kybernos-cloud). Each finished turn is also written on the person's thread on
  the server, and the last words said there (Telegram's) are told back in the prompt: one assistant, one memory, one conversation, two
  bodies (this machine here, its cloud computer on Telegram). A server with no Kaby thread is simply left alone.
- **The strip** (collapsible, in the dock above that chat's composer and above no other's) is **two equal tiles** and, under them, one
  panel that exists only while Telegram needs something. It is open while Telegram is not connected; once it is, or when the server has
  no Telegram bot, it is folded to its header (the name, and two chips: Telegram and the computer). The person's choice wins, and is
  remembered. Nothing above the tiles files the computer under « Channels ».
  - **Channels tile**: Telegram, WhatsApp and WeChat, one row each, with their marks. Telegram has a **switch**: turning it on asks for a
    code (never when the strip opens), turning it off cancels a code in flight or, for a connected chat, asks before disconnecting.
    WhatsApp and WeChat say « Soon » and offer nothing. The person may turn on several, as they come.
  - **Computer tile**: the cloud computer linked to the assistant, drawn as a select (a real `<select>` when there are several, kept by
    the server through `POST /kybernos-cloud/kyby/computer` and used by Telegram too), its state (awake, asleep, **setting up**) and, on a
    plan that allows it, wake / sleep / open. Every person has one, made at the first request that needs one: until then it is
    « on request »; once made, « Setting up a machine dedicated to you » turns into « Asleep » by itself (the page reads again every few
    seconds while a computer is being made, woken or put to sleep). On the Free plan the server says `manual_control: false`: no wake
    button, the short note and an upgrade button (the footer's Upgrade dialog through `window.__KB_UPGRADE__`, else the plan page).
  - **The panel under the tiles**: the code (QR, three steps, « Open Telegram », the time left, « Cancel »), then who Telegram says it is
    while the person confirms there; expired, refused, « already another account's », « made by the bot » and « too many tries » are
    its own cards; and the question before disconnecting. The tiles keep their height while it is open.
- The same panel is a tab of the right-hand panel, and the page the new-chat card opens (what Kaby is, the way into the chat).

The bundle talks only to `kybernos-cloud`'s routes (`/kybernos-cloud/kyber`, `/telegram/pairing[...]`,
`/telegram/unlink`, `/kyby/computer`, `/kyby/native[/set]`, `/computer/*`, `/console/link`), which add the account's token; the QR is computed there.
No engine patch. The assistant's name is one constant (`NAME`) here and the label `kbui.kyber` in kybernos-plugin.

Tests, without DSH: `node packages/kybernos-kyber/test-client.mjs` (the model, and the real views rendered with a stub React, with `fetch` and timers recorded),
`node packages/kybernos-kyber/test-host.mjs`, and the host half in
`node packages/kybernos-cloud/test-kyby.mjs` and `test-kyby-native.mjs`. In a real GUI (the sandbox instance, the account's answers
faked): `source scripts/sandbox/env.sh && node scripts/check-kyby-live.mjs [--shots <dir>]`.
