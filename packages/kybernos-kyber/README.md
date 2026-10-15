# kybernos-kyber

A **Kyby** tab in the chat's right-hand panel (ADR 0053 § 14): where your assistant answers you, and the computer it works on.

- **Telegram**: not set up on this server / not connected yet / connected as *name* since *date* (paused or blocked say so).
  « Open the bot » goes to `t.me/<bot>`; « Manage in my account » to the account page, where the code the bot gives is typed.
- **My computer**: the `Home` computer the bot makes at the first message that asks it to act: asleep / awake / being made, its
  image version, its last activity and what it may reach on the network.
- A line saying that the computer asks for the person's approval in Telegram before it acts (Allow, Refuse, Allow for this task).

It **only reads**: `GET /kybernos-cloud/kyber` (served by `kybernos-cloud` with the account's token) and `GET /kybernos-cloud/server`
(the address of the account page). A device cannot link or unlink a chat (the server asks for a signed-in session), so the tab sends the
person to the bot and to their account. The QR pairing from DSH (ADR 0053 § 13.6) is not built.

No engine patch. Tested without DSH: `node packages/kybernos-kyber/test-client.mjs`, `node packages/kybernos-kyber/test-host.mjs`.
