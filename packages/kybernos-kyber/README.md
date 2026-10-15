# kybernos-kyber

**Kaby**, the person's own assistant (ADR 0053 of kybernos-server): a real DSH conversation, the doors it answers from, and the computer it
works on.

- **The conversation is DSH's own.** The menu row **Kaby** opens a normal DSH chat (DSH's composer, rendering and tools), made the first
  time in a workspace of its own (`<DSH home>/kybernos/kyby`, so « New chat » never takes it back) and remembered by the host
  (`<DSH home>/kybernos-kyby.json`). Its brain is DSH's agent on this machine, with the account's memory; for that chat only the host adds
  Kaby's identity to the system prompt (`kyby-native.mjs` in kybernos-cloud). Each finished turn is also written on the person's thread on
  the server, and the last words said there (Telegram's) are told back in the prompt: one assistant, one memory, one conversation, two
  bodies (this machine here, its cloud computer on Telegram). A server with no Kaby thread is simply left alone.
- **Channels strip** (collapsible; open until Telegram is connected, folded after, the person's choice wins), in the dock above that
  chat's composer and above no other's:
  - **Telegram**: a QR code and an « Open Telegram » link. The person scans or taps, presses Start, taps « Yes, it's me » in Telegram;
    the strip follows the pairing by itself (waiting, then who Telegram says is asking, then connected). Expired, refused, « already
    another account's » and « made by the bot » are their own cards. Connected is one line, with Open and Disconnect (confirmed).
  - **WhatsApp** and **WeChat**: shown with their mark and « Soon ». Nothing is offered.
  - **Where Kaby works**: which computer answers a Telegram message that asks it to act: Kaby's cloud computer, or « ask me »
    (Telegram buttons). « My Mac » is shown greyed: DSH must report its presence to the server first (ADR 0053 § 13.4).
- **Kaby's computer**: asleep / awake, last activity. On the Free plan the server says `manual_control: false`: no wake, sleep or open,
  only an upgrade button (the footer's Upgrade dialog through `window.__KB_UPGRADE__`, else the plan page). Kaby wakes it itself.
- The same panel is a tab of the right-hand panel, and the page the new-chat card opens (what Kaby is, the way into the chat).

The bundle talks only to `kybernos-cloud`'s routes (`/kybernos-cloud/kyber`, `/telegram/pairing[...]`, `/telegram/settings`,
`/telegram/unlink`, `/kyby/native[/set]`, `/computer/*`, `/console/link`), which add the account's token; the QR is computed there.
No engine patch. The assistant's name is one constant (`NAME`) here and the label `kbui.kyber` in kybernos-plugin.

Tests, without DSH: `node packages/kybernos-kyber/test-client.mjs`, `node packages/kybernos-kyber/test-host.mjs`, and the host half in
`node packages/kybernos-cloud/test-kyby.mjs` and `test-kyby-native.mjs`. In a real GUI (the sandbox instance, the account's answers
faked): `source scripts/sandbox/env.sh && node scripts/check-kyby-live.mjs [--shots <dir>]`.
