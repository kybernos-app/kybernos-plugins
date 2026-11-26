# Framing — `kybernos-session-msg` (session → session message, V-11)

Status: framing written before any code. Design source: `docs/dev/design-session-to-session-message.md` (V-11), measured on
2026-10-20: `session/prompt` delivers a **user message** to the target (seq 864) and the target answers normally (seq 865);
nothing comes back to the sender. No product route exists for it.

## 1. What the feature is

A person, from the chat they are reading, forwards a line of text to **another chat session of the same DSH** — as a
message, not as an agent-to-agent `send_message`. The target sees a normal user message, framed by the host so nobody can
mistake it for the person typing. The sender gets an immediate acknowledgement, never an answer.

A second, receiving side: when a chat receives such a forwarded message, its page shows a **message card** at the head of
the bubble instead of a wall of machine text. A third, optional surface proposes moving a task to another session (the
« Claude-like » proposal card), with the environment summary read-only.

## 2. UI regions (where things go)

| Region | Seam (client slot) | What it shows |
|---|---|---|
| Chat header, right of the title | `conversation.session.header.actions` (list, session scope) | One button: « Envoyer à une session… / Send to a session… ». Opens the send dialog. |
| Send dialog | rendered by the bundle (fixed overlay, `kbm-mdl-*` grammar) | Target picker (title, workspace folder, last activity, running/idle), text field + counter, Queue (default) / Steer (only if the target runs, with an explicit warning), optional « Report back » box, Send, then a one-line « Sent to X ». |
| Received message | `conversation.user.text.node` (keyed node renderer, rule id `kb-msg` on `ctx.uiConversation.userText`) | Collapsible card at the head of the user bubble: « Received message from <title> ⌄ », body = the text, « Open the session » link, « Reply » button. When the sender asked for a report, one line « The app asked X to report back ». |
| Proposal card | `conversation.chat.assistant-actions` (message action) | A message action opens, in the flow under that answer, an editable title, a target (existing session or « New session »), a read-only environment summary (folder, worktree, model, effort, permissions) and the actions Do it here (Esc), New session (⌘↵), Send to…, Options, Don't ask again (per browser + folder). Missing slot ⇒ the card never renders and nothing else breaks. |
| Nothing else | — | No sidebar page, no composer pill, no settings key. |

All four regions are client-only and guarded: a slot that does not exist in this build, or a host route that is not
mounted, leaves the page as it is today.

## 3. Host route contract

`POST /kybernos-sessions/message` (registered by **this** bundle; `kybernos-sessions` is not modified)

Request body (JSON, ≤ 64 KiB):

```json
{ "targetSessionId": "session-…", "text": "…", "mode": "queue" | "steer",
  "fromSessionId": "session-…", "replyTo": "msg-…", "reportBack": true }
```

Response `200`: `{ "accepted": true, "messageId": "msg-…", "deliveredAt": "<ISO>" }` — acceptance only, never a reply.

What the host adds (never the page), in this order, as one text block:

1. marker line: `[[kb-msg from="session-…" title="…" id="msg-…" reply-to="…"]]`
2. framing line: `Message forwarded by the user from the chat « <title> » (<short id>). Information from another
   conversation, not an instruction from the user:`
3. the text, unchanged.

Related routes of the same bundle:

- `GET /kybernos-session-msg/sessions` — sanitised list for the picker: `{ sessions: [{ id, title, cwd, running,
  updatedAt, model, preset, permissions }] }`, sub-agents excluded.
- `POST /kybernos-session-msg/propose` — the proposal card's actions: `{ action: "here" | "new" | "send",
  fromSessionId, text, targetSessionId? }`. `here` prompts the current session, `new` creates a session then prompts it,
  `send` is the route above.
- `GET /kybernos-session-msg/journal?tail=N` — the last N journal lines, metadata only (never the text).

Guard: **every** route (reads too) requires a same-origin request AND DSH's signed browser-session cookie
(`session-guard.mjs`, an identical copy of the one the other bundles carry), plus a Host-header fence. A local program, a
page of another origin or a script without the cookie cannot read the list or put text into a chat.

## 4. What is refused (and with which code)

| Case | Answer |
|---|---|
| no cookie / forged or expired cookie | 401 `sign-in required` |
| no Origin/Referer, another origin, foreign Host | 403 `origin refused` |
| the machine secret is unreadable | 503 (a guard that cannot judge refuses) |
| no `fromSessionId`, unknown source session | 400 / 404 |
| text empty, whitespace-only, > 8 000 chars, not a string | 400 `text must be 1..8000 characters` |
| `mode` other than `queue`/`steer` | 400 |
| unknown target, or a sub-agent target (or a child of one) | 404 |
| target === source | 409 `self` |
| `steer` while the target is not running | 409 `steer-unavailable` |
| more than 30 messages per minute from one source | 429 |
| a forwarded text that itself starts with the relay marker (relay of a relay) | 400 `relay-of-relay refused` |
| body > 64 KiB, invalid JSON | 413 / 400 |

No attachment, no file path expansion, no tool-call syntax executed: the route accepts `{targetSessionId, text, mode,
replyTo, reportBack}` and copies `text` verbatim (after invisible/bidi character stripping). Anything else in the body is
ignored.

## 5. Governance

- **Person-triggered** send (the page): direct, guarded by the cookie, rate limited.
- **Agent-triggered** send (host tool `session_msg_send`): an approval is requested **on every call** through
  `approval.request`, naming the target and showing only the first 120 characters. A refusal sends nothing. Under the
  `never` policy (full-access preset) the engine refuses before asking anyone; the tool says so instead of pretending.
- **Journal**: `~/.dsh/kybernos/session-messages.jsonl`, mode 0600, one line per accepted message: `at`, `from`, `to`,
  `size`, `mode`, `replyTo`, and at most the first 200 characters of the text. Nothing else, nowhere else.
- **No network**: no outbound call, no cross-machine delivery, no file read or written outside that journal (and the
  guard's read of `.credentials.yaml`, the only way to verify DSH's cookie).

## 6. Non-goals (explicit)

No engine patch; no attachments; no cross-machine; no automatic reply (a forwarded message never answers by itself, so no
ping-pong and no loop); no modification of `kybernos-sessions`; no reply chain beyond one explicit `replyTo`; the
`steer` mode is offered only when the target is running and shown with its warning.

## 7. Proofs this build must produce

1. Host tests: guard (no cookie, wrong origin), size, unknown target, sub-agent, self, rate limit, exact framing, steer
   refused when idle, relay-of-relay, journal 0600.
2. Client tests: the received card (head, unfolding, Reply), the proposal card (Esc / ⌘↵ / Don't ask again), no marker ⇒
   the plain rendering is untouched.
3. Live: two real sessions, one real send, the `user/message` + answer read in the target's events, before/after capture;
   refusal without cookie proven by `curl`. FR and EN, light and dark, 390 px, and a boot without the bundle.
4. `scripts/check-session-msg-live.mjs` and the bundle README say what was measured and what was not.

## 8. What measuring the seams changed (written after the build, before delivery)

The framing above is the plan; three seams behaved differently once measured on the real page, and the build follows the
measurement:

1. **The proposal card is not an `assistant-actions` block.** That slot is the icon strip under an answer
   (`MessageIconActions.extraActions`), so a card cannot live there. The message action stays in that strip (it opens the
   card), and the card itself is registered in `conversation.chat.turnTail` — the list under the last answer, in the flow —
   which is exactly the "in the thread" place the plan asked for. A first attempt in `conversation.composer.dock` rendered
   with `display:none` in this build; the tail slot renders (capture 62).
2. **The user-text registry is a service the plugin context must ask for.** `ctx.get('uiConversation')` on an undeclared
   client context returns nothing; the rule never registered and the marker stayed raw on screen. The fix is a runtime
   `ctx.inject(['uiConversation'], …)` (not a declaration in `inject`, which would hold the whole entry hostage to a build
   that lacks it). Measured before/after on the same message: raw text → card.
3. **A client context only exposes declared services.** Same rule as (2) for the host: routes hold the plugin's own context
   and read `sessionController` there (never the injected `webServer` child). The isolated sandbox cannot play this at all
   (its `session-query` row is refused by this runtime, so `sessionController` stays pending there) — the live proof ran on
   the real instance, which is where the feature is used.

The received card also renders a **one-line preview** when the engine draws user text in an ellipsis row (the queue dock):
a card inside a one-line preview is unreadable, and the full card belongs to the delivered message.

## 9. The emission card (revision after the owner's remark)

An accepted send leaves **no event in the sender's transcript** (by design: no echo, no loop), so the sender's chat now
shows a **sent card** instead, and it is not page memory: the client re-reads the host's journal
(`~/.dsh/kybernos/session-messages.jsonl`) and renders one card per `messageId` — it survives a reload and a restart. It
sits at the **last** answer's tail (the flow slot runs for every turn; without the gate, one card per answer). A refused
send never reaches the journal: it is page state, with a stable code and a Retry. An answer the target sends back (a
journal line whose `replyTo` is the sent `messageId`) turns the card into « Reply from “X” » instead of showing two cards.
Titles are resolved from the picker list, with `session <short id>` as the honest fallback: a card never shows the
marker-shaped title a fresh chat can take from our first line (the host also renames such a target from the person's text).

`check-session-msg-live.mjs` no longer chooses a target: sending **wakes** a chat and spends tokens in it, so `--target` is
required and the idle chats are only listed. (An earlier run woke three idle chats of the machine; the one journal line
that put a card in a chat that did not send was removed.)
