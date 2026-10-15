# kybernos-kyber

**Kyby**, the person's own assistant (ADR 0053 of kybernos-server): one conversation, the doors it answers from, and the computer it
works on, on one page. The menu row **Kyby** opens it; the same panel is also a tab of the chat's right-hand panel.

- **Chat**: talk to Kyby here, on the thread every door shares (what is written on Telegram is in it too). It is a hosted turn in
  the cloud on the person's allowance, in words only: acting on Kyby's computer needs the approvals, which today are asked in
  Telegram, so the page says to write there for that. It is not a local DSH session: for work on the person's own machine a DSH
  chat is the tool. The
  transcript is drawn by this page (plain text), because DSH has no way to put a server's messages into a session's transcript.
- **Channels strip** (collapsible; open until Telegram is connected, folded after, the person's choice wins):
  - **Telegram**: a QR code and an « Open Telegram » link. The person scans or taps, presses Start, taps « Yes, it's me » in Telegram;
    the page follows the pairing by itself (waiting, then who Telegram says is asking, then connected). Expired, refused, « already
    another account's » and « made by the bot » are their own cards. Connected is one line, with Open and Disconnect (confirmed).
  - **WhatsApp** and **WeChat**: shown with their mark and « Soon ». Nothing is offered.
  - **Where Kyby works**: which computer answers a Telegram message that asks it to act: Kyby's cloud computer, or « ask me »
    (Telegram buttons). « My Mac » is shown greyed: DSH must report its presence to the server first (ADR 0053 § 13.4).
- **Kyby's computer**: asleep / awake, last activity. On the Free plan the server says `manual_control: false`: the page offers no
  wake, sleep or open, only an upgrade button (the footer's Upgrade dialog through `window.__KB_UPGRADE__`, else the plan page).
  Kyby itself wakes the computer when it has work.

The page **talks only to `kybernos-cloud`'s routes** (`/kybernos-cloud/kyber`, `/telegram/pairing[...]`, `/telegram/settings`,
`/telegram/unlink`, `/kyby`, `/kyby/send`, `/computer/*`, `/console/link`), which add the account's token; the QR is computed there.
No engine patch. The assistant's name is one constant (`NAME`) here and the label `kbui.kyber` in kybernos-plugin.

Tests, without DSH: `node packages/kybernos-kyber/test-client.mjs`, `node packages/kybernos-kyber/test-host.mjs`, and the host half in
`node packages/kybernos-cloud/test-kyby.mjs`. In the real GUI (answers faked, nothing written):
`node scripts/check-kyby-live.mjs [--shots <dir>]`.
