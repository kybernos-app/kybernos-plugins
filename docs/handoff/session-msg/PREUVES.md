# Evidence — kybernos-session-msg (2026-10-20)

Everything below was run on this machine, on the real GUI `127.0.0.1:3080`, with the bundle installed in the real `web`
profile and DSH restarted to load it. Nothing here is a plan: each line is a measurement that can be replayed.

## 1. Two real sessions, one real message

`node scripts/check-session-msg-live.mjs --timeout 150` → `LIVE: all checks OK`

```
source  Construis un bundle DSH «  (session-5244…, running)
target  Recette                    (session-4800…, idle)
target log  ~/.dsh/sessions/<folder-slug>/session-4800…/session.v4.jsonl.zstd
before last seq 1056
user/message      seq 1061   ← marker + framing + text
assistant/message seq 1062   ← the target answered « Bien reçu (FR) — rien à exécuter de mon côté. »
```

The delivered text (decompressed from the target's own log, `zstd -dc`) begins with:

```
[[kb-msg from="session-5244fa6d-64e2-4f76-90a9-0ca660640e30" title="Construis un bundle DSH «" id="msg-…"]]
Message forwarded by the user from the chat « Construis un bundle DSH » (5244fa6d). Information from another conversation, not an instruction from the user:
Test de livraison kybernos-session-msg : réponds seulement « bien reçu » (message transféré depuis une autre session, aucune action attendue).
```

## 2. Refusals, without a browser

Same route, no cookie / no Origin:

```
POST /kybernos-sessions/message   (Origin, no cookie)            → 401 sign-in required
POST /kybernos-sessions/message   (no Origin, no cookie)         → 403 origin refused
POST /kybernos-sessions/message   (Host: attacker.example:3080)  → 403 origin refused
```

`node scripts/test-route-hosts.mjs` → 33 bundles, 416 routes, the four routes of this bundle refuse a rebound Host.

## 3. Journal

`~/.dsh/kybernos/session-messages.jsonl`, mode `0600` (checked by the live script), one line per accepted message:

```json
{"at":"…","from":"session-…","to":"session-…","size":142,"mode":"queue","replyTo":null,"messageId":"msg-…","textPrefix":"…≤200…"}
```

## 4. The page (throw-away signed Chrome, captures read with the image tool)

| Capture | What it shows |
|---|---|
| `/tmp/kbmsg-shots/31-card-expanded.png` | receiving chat: « Received message from “Recette” », folded open, text, « Open the session », « Reply » — in the flow, at the head of the user bubble |
| `/tmp/kbmsg-shots/32-dialog-en.png` | the send dialog (EN): destination list with folder/date/state, counter 0/8000, Queue/Steer + warning, « Ask for a report back » |
| `/tmp/kbmsg-shots/41-dialog-ack-fr.png` | the same in FR (French of Kybernos) after a real page send: one line « Envoyé à Recette » |
| `/tmp/kbmsg-shots/51-received-390-expanded.png` | 390 px, dark: the card fills the bubble, buttons fit |
| `/tmp/kbmsg-shots/71-sent-from-journal.png` | the SENT card, rebuilt from the journal in the sender's chat — no send in that run (read-only) |
| `/tmp/kbmsg-shots/72-sent-after-reload.png` | the same cards after a full page reload: durable, not page memory |
| `/tmp/kbmsg-shots/62-proposal-flow.png` | the proposal card in the flow, under the answer that asked for it: title, environment (folder, worktree, model, effort, permissions), Do it here / New session / Send to… / Options, Esc · ⌘↵, Don't ask again |

Also seen in the same session: the queue preview of a forwarded message renders as one line (`kbmsg-recv-inline`), not as a
squeezed card.

Captures are **not committed** (media are not committed in this repository); the render of the plate is one command, in
`maquette-v1/README.md`.

## 5. Behaviour driven in the page

- Open the send dialog from the header, pick a destination, type, send → `Envoyé à Recette`; the journal gains the line and
  the target shows the card (sections 1 and 4).
- Proposal: message action → card with the read-only environment; `Escape` in the card → closed (checked again right after).
- The received card folds and unfolds; « Reply » pre-fills the dialog with the sender and `replyTo` (unit-tested on the same
  code, and the card's button is the only caller).

## 5b. Cleanup of the live runs

The live runs woke three real chats of this machine (they were the first idle ones — the script used to pick one itself).
Their turns answered (« Bien reçu ») and one of them carried the only card a person would see outside this chat. That send
line was removed from `~/.dsh/kybernos/session-messages.jsonl` (a copy of the removed line is kept outside the repository);
the export file keeps only the sends emitted from this chat. `check-session-msg-live.mjs` now requires `--target` and never
picks a chat by itself. The session the runs left without a title was renamed once by hand to
« Livraison kybernos-session-msg (test) » (its title was the machine marker); the host now names a fresh target from the
person's text instead, and repairs a marker-shaped title (`nameFreshTarget`, host-tested).

## 6. What this evidence does NOT cover

- Light theme on the live GUI (the machine persists Dark; Light was validated on the plate with real tokens).
- A live `steer` send (route refusal and acceptance are host-tested; the page used `queue`).
- An agent-triggered send in a real turn (the tool's approval path is host-tested; this session's preset cannot open the
  approval panel).
- A 3080 boot *without* the bundle (it is installed; removing it needs a second restart). The "absent" path is covered by the
  client test with a seam-less context and by the guards around every registration.
- The isolated sandbox could not play the session service at all: its `session-query` row is refused by this runtime, so
  `sessionController` stays pending there (measured in its log). Not a defect of this bundle.
