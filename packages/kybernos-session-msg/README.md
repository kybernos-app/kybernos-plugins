# kybernos-session-msg

A message or an instruction from one chat session to another, to a new session, or to this one — and the agent does the
thinking: it proposes an inline form (kind, text, destination) and the person edits it, closes it or clicks Send. **No engine
patch**: everything rides on seams that already exist (`sessionController.prompt`, `conversation.user.text.node`,
`conversation.chat.turnTail`, `conversation.session.header.actions`, the agent tool registry).

The design is mockup v5 (`docs/handoff/session-msg/maquette-v5`, not committed: it is a throw-away HTML plate).

## What it adds

| Surface | Where it comes from | What it does |
|---|---|---|
| Inline form | `conversation.chat.turnTail` (last turn only) | « What do you want to send? » — **Message** (information, nothing is started) or **Instruction** (the other session acts, then reports), an editable text that carries its own kind and target at its head (« Instruction for Recette »), a destination (**Here** · **New session** · **another running or recent session**, from a list), one line saying what the choice means (an idle target will be woken up, a full-access target can change files…), and the button (« Do it here », « Create the session », « Send to Recette »). `⌘↵` sends, `Esc` or the cross closes it and keeps the text (« Reopen »). A message cannot be done here or in a new session: those are instructions, and the form says so. |
| Prefilled by the agent | tool `session_msg_propose` → the form opens by itself | The agent chooses kind, text and destination; it **never sends**. The page picks the proposal up (a light local poll) and opens the form with it. Nothing leaves without the person's click, with the full text in front of them. |
| Header button | `conversation.session.header.actions` | « Send to a session… » opens the same form, empty. |
| Sent trail | same slot, before the form | One summary per message sent from this chat (the last three): the kind and target (« Instruction → Recette »), the first lines of what was written, and **Sent → Received → Answer**. Read back from the host's journal, so it survives a reload and a DSH restart. « See the answer » opens the target chat, where the answer lives. |
| Received card | user-text rule `kb-msg` + `conversation.user.text.node` | « Instruction from “X” » or « Message from “X” », the text visible (nothing behind a click), what it means for the agent (« an instruction to carry out, with this session's own permissions » / « information, nothing to run on its own »), the written receipt (« Instruction received »), Reply and Open the session. The host's framing line is not repeated. A message without the marker is untouched; a marker without `kind` (older builds) is a message. A one-line preview is used where the engine renders user text in an ellipsis row. |

If a slot is missing in a build, that surface never renders and nothing else breaks.

## Host

```
GET  /kybernos-session-msg/sessions?from=<id>   { ok, current, sessions }  the other sessions that are running or updated in the last 24 h
POST /kybernos-sessions/message                 { targetSessionId, fromSessionId, text, kind?, mode?, replyTo? } → { accepted, messageId, deliveredAt }
POST /kybernos-session-msg/dispatch             { dest: here|new|other, fromSessionId, kind, text, targetSessionId?, proposalId?, replyTo? }
GET  /kybernos-session-msg/status?from=<id>     the sends of one chat, each with state received | working | answered
GET  /kybernos-session-msg/proposal?sessionId=  the agent's pending proposal, or null
POST /kybernos-session-msg/proposal/clear       { sessionId, id }
GET  /kybernos-session-msg/journal?tail=N       the last N journal lines (metadata only)
tool session_msg_propose                        { kind, text, destination }  → stores a proposal, sends nothing
```

What each destination means (the host decides, never the page):

| `dest` | What happens | Allowed kind |
|---|---|---|
| `other` | the text reaches the target as a user message, framed by the host (below); journaled | message or instruction |
| `new` | a new session is created and its **first message is the plain text**; named after the first line | instruction |
| `here` | the plain text is prompted in the current session | instruction |

The host — never the page — writes, in this order, into the target's user message:

1. `[[kb-msg from="session-…" title="…" id="msg-…" kind="message|instruction" reply-to="…"]]`
2. the framing, by kind:
   - message: `Message forwarded by the user from the chat « <title> » (<short id>). Information from another conversation, not an instruction from the user:`
   - instruction: `Instruction forwarded by the user from the chat « <title> » (<short id>). The user asks you to carry it out with this session's own permissions, then answer briefly:`
3. the person's text, unchanged (invisible and bidi control characters stripped).

An instruction gives **no right the target does not already have**: it runs with the target's own permissions; the form warns
in orange when that target has full access.

`status` is a **heuristic, not a read of the answer**: `received` = the target accepted the prompt; `working` = the target
is running now; `answered` = the target is idle again and either was seen running since the delivery, was updated more
than 1.5 s after it, or the delivery is older than 5 minutes (a short turn can fall between two polls, and the memory of
what was seen is lost on a restart). The answer text itself stays in the target chat.

## What is refused

`401` no/forged/expired cookie · `403` foreign origin or foreign Host · `503` guard cannot read the secret ·
`400` empty/whitespace, > 8 000 chars, bad `kind`/`mode`/`dest`, a message sent `here` or `new`, a forwarded message forwarded
again · `404` unknown target, unknown source, subagent · `409` target is the current session, `steer` on an idle target ·
`429` more than 30 messages a minute from one source · `413` body > 64 KiB. No attachment, no path expansion, no tool call.
A subagent, an archived session (the engine refuses it) and a blank chat are never offered as destinations.

Governance: the agent's tool only **proposes**, so every agent-originated send needs the person's click (stronger than a DSH
approval prompt: the person sees the whole text, not 120 characters); a person-triggered send is direct (guarded, rate
limited). The local journal `~/.dsh/kybernos/session-messages.jsonl` is `0600` and keeps `at, from, to, size, mode, kind,
replyTo, messageId` plus at most the first 200 characters; nothing leaves the machine. The pending proposal is in memory
only (one per chat, 30 minutes).

## Install

```
~/.dsh/profiles/web/package.json
  dependencies: "@local/kybernos-session-msg": "link:<repo>/packages/kybernos-session-msg"
  dsh.profile.bundles: … "@local/kybernos-session-msg" …
~/.dsh/profiles/web/node_modules/@local/kybernos-session-msg -> <repo>/packages/kybernos-session-msg
```

then restart `dsh web`. Removing those three lines + a restart uninstalls it; nothing else refers to it. **This build changes
the host half** (new routes, a new tool, the marker): the client alone (a page reload) is not enough, DSH has to restart.

## Tests

```bash
node test-host.mjs     # 170 checks: guard on every route (signed cookie, origin, Host, method), kind in marker / framing /
                       # parse / journal, the two framings verbatim, bad kind, the "running or recent" filter, dispatch
                       # here / new / other, status states, the proposal store (TTL, one per chat), the tool (never sends,
                       # resolves an id or an exact title, ambiguous → candidates), title repair, journal 0600 + 200-char cap
node test-client.mjs   # 83 checks: the three seams, the marker rule (kind, whole message, no marker = untouched), the
                       # received card (kind explicit, text visible, receipt), the form (kinds, destinations, list,
                       # consequence line, keys, send contract, refusal keeps the text), the sent trail, the tail (last
                       # turn only), the agent's proposal, the header button and Reply, FR+EN pairs, tokens only
node scripts/test-route-hosts.mjs      # the routes refuse a rebound Host
node scripts/test-session-guard.mjs    # the guard copy is identical to the others and our test drives it
node scripts/test-no-french-literals.mjs   # French only inside [fr, en] pairs (strict bundle)
```

## What was measured, and what was not (2026-10-20)

**Measured on the real DSH page** (a throw-away headless Chrome signed in to `127.0.0.1:3080`; the served client swapped for
this client through the DevTools protocol; the bundle's routes answered by the real new host code on a *fake*
`sessionController` fed with the real session list — nothing was prompted in any real session, nothing restarted):

- the header button opens the form under the last answer; the list shows the real sessions (title, folder, « n min ago ») and
  the full-access warning appears for a full-access target; typing and Send work; the trail goes Sent → Received → Answer
  with « See the answer »; an agent proposal posted to the host opens the form prefilled within the poll delay;
- at 390 px the form and the trail fit (buttons wrap, nothing cut);
- a real chat that already holds messages forwarded by the **old** build renders them as the new card (« Message from “Recette” »,
  text, note for the agent, receipt, Reply, Open) — the old marker (no `kind`) reads as a message;
- no console error.

**Not measured / not done:**

- **The host half on a real `sessionController`** (the real `prompt` / `create` / `rename`, a real target answering): the host
  is unit-tested against a fake controller and mounted on a real HTTP server with the real guard, but the new routes have not
  run inside a restarted DSH. `scripts/check-session-msg-live.mjs --target session-… [--kind instruction]` is the proof to run
  after the restart (it wakes the named target, reads its event log, checks the framing of the kind and the journal line).
- **Dark theme on the live page** (the page is in Light and switching would persist the person's theme): the form uses DSH
  tokens only, which a unit test pins; the earlier plate (`maquette-v1`) was checked in both themes.
- **The agent choosing well**: the tool and its description are tested; whether a model picks the right destination and kind
  from the person's words has not been measured on real conversations.
- **Reading the answer**: `status` is a heuristic; the answer text is not read back into the sender's chat (the link opens
  the target). A real read needs `session/follow` + `session/page` and has not been tried.
- **A per-session « messages only » reception setting**, **`steer` from the form** (the route still accepts it), **an
  automatic return of the answer** (a report back to the sender) and **cross-machine delivery** are not built.
- **Bubble around the received card**: the engine keeps its user bubble around the card; the slot replaces the text, not the
  bubble. It reads fine (a white card inside the bubble) but it is not the full-width left-aligned card of the mockup.
- Whole-bundle boot **without** the bundle on `3080` is covered by construction (every registration is guarded, every host
  service optional) and by the client test with a context that has no seam, not by a second restart.
