# kybernos-kyber

**Kaby**, the person's own assistant (ADR 0053 of kybernos-server): a real DSH conversation, the doors it answers from, and the computer it
works on.

- **The conversation is DSH's own.** The menu row **Kaby** opens a normal DSH chat (DSH's composer, rendering and tools), made the first
  time in a workspace of its own (`<DSH home>/kybernos/kyby`, so « New chat » never takes it back) and remembered by the host
  (`<DSH home>/kybernos-kyby.json`). Its brain is DSH's agent on this machine, with the account's memory; for that chat only the host adds
  Kaby's identity to the system prompt (`kyby-native.mjs` in kybernos-cloud). Each finished turn is also written on the person's thread on
  the server, and the last words said there (Telegram's) are told back in the prompt: one assistant, one memory, one conversation, two
  bodies (this machine here, its cloud computer on Telegram). A server with no Kaby thread is simply left alone.
- **Channels strip** (collapsible, in the dock above that chat's composer and above no other's). It is open only while there is a code
  to scan; once Telegram is connected, or when the server has no Telegram bot, it is folded to one line (two chips: Kaby's computer and
  Telegram). Opened, in this order:
  - **Kaby's computer**: the cloud computer linked to the assistant (every person has one, made at first use: until then it is « ready at
    the first request »), its state, and, on a plan that allows it, wake / sleep / open. On the Free plan the server says
    `manual_control: false`: no buttons, an upgrade button (the footer's Upgrade dialog through `window.__KB_UPGRADE__`, else the plan page).
    With several cloud computers a plain choice appears (`POST /kybernos-cloud/kyby/computer`, kept by the server, used by Telegram too).
  - **Telegram**: a QR code and an « Open Telegram » link. The person scans or taps, presses Start, taps « Yes, it's me » in Telegram; the
    strip follows the pairing by itself. Expired, refused, « already another account's » and « made by the bot » are their own cards.
    Connected is one line, with Open and Disconnect (confirmed). A server with no Telegram bot is one muted line naming the server.
  - **WhatsApp** and **WeChat**: one muted « Soon » line with their marks. Nothing is offered.
- The same panel is a tab of the right-hand panel, and the page the new-chat card opens (what Kaby is, the way into the chat).

The bundle talks only to `kybernos-cloud`'s routes (`/kybernos-cloud/kyber`, `/telegram/pairing[...]`,
`/telegram/unlink`, `/kyby/computer`, `/kyby/native[/set]`, `/computer/*`, `/console/link`), which add the account's token; the QR is computed there.
No engine patch. The assistant's name is one constant (`NAME`) here and the label `kbui.kyber` in kybernos-plugin.

Tests, without DSH: `node packages/kybernos-kyber/test-client.mjs`, `node packages/kybernos-kyber/test-host.mjs`, and the host half in
`node packages/kybernos-cloud/test-kyby.mjs` and `test-kyby-native.mjs`. In a real GUI (the sandbox instance, the account's answers
faked): `source scripts/sandbox/env.sh && node scripts/check-kyby-live.mjs [--shots <dir>]`.
