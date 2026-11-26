# Design note: suggested tasks after an answer (V-12)

Status: design only, nothing built. Asked by the owner (audit 2026-10-16, V-12): 2 or 3 clickable suggestions after each agent
answer. **A suggestion is a prefilled prompt, never an automatic run.** Checked by grep: nothing named `suggested-tasks`,
`suggestedTasks` or `nextSteps` exists in any package.

## What exists to build on

| Piece | Where | Use here |
|---|---|---|
| Prefill the composer | `conversation.input.shell(id).actions.setDraft(text)` (`kybernos-plugin/client.js`, with a DOM fallback), the call the new-chat cards and starters already use | a click puts the text in the box; the person edits it and presses send. No call to `prompt` anywhere in the chip's code |
| A place above the box | slot `conversation.input.dock` (`kybernos-starters` order 30, `kybernos-newchat` order 25) | the chips sit here, between the answer and the composer, where the eye is when the answer ends |
| A place under the answer | slot `conversation.chat.assistant-actions` (the rating card) | possible, but it scrolls away with the answer |
| A cheap host-side model call | `/kybernos/starters-suggest` (`index.js`): `llm.stream({ provider, model, messages, maxTokens, purpose })` on the **Study model** (`brain` in Kybernos Settings; Automatic by default, a local model when one exists) | the same call, a new `purpose: 'kybernos-next-steps'` |
| The answer's text | the session projection of the open chat, read by the client the way the usage chip reads `tokenUsage` (to confirm: which projection row holds the last assistant message) | the chip row reads the last answer |

## Three ways to produce them

| | How | Extra cost per answer | Quality | Risk |
|---|---|---|---|---|
| **A. Rules** | pure function over the answer text: a code block gives « Explain this code » and « Write tests for it »; a numbered list of options gives « Do option 2 »; an error trace gives « Find the cause »; a file path gives « Open it and summarise »; nothing recognised gives nothing | none | modest, predictable, never wrong in kind | none: no model, no network |
| **B. A small model call** | after the turn ends, the host sends the last 1 500 characters of the answer and the chat title to the Study model and asks for 3 prompts of at most 12 words, as JSON | about 600 input and 80 output tokens: free on a local model, about $0.0001 on a flash model, about $0.003 on a large paid one, so **only the Study model, never the chat's own model** | good | a call after every answer: a switch (off by default), a size floor, one call per answer id, abandon on the next keystroke |
| **C. Ask the main model** | a system-prompt chunk asking it to end each answer with a `<next>` block | 60 output tokens on every answer, on the paid model | variable | changes the answer text, needs stripping when drawn, breaks when the model forgets: **not recommended** |

**Proposal: A first (a day, no cost, no new permission), B behind a Settings switch as a second step** that falls back to A when
no Study model qualifies.

## Behaviour (all of it, for A and B)

- Shown only when the last event is a **finished assistant answer**, the composer is **empty**, and the session is idle.
- 2 or 3 chips, one line each (one line of 56 characters; the full prompt is in the tooltip). Click: `setDraft(fullPrompt)`, focus the
  box, chips vanish. **No click sends anything.** There is a test for it: the chip's handler is read as text and must not contain
  `prompt(` or `submit`.
- Vanish also when the person types, sends, switches chat, or presses the small ✕ (« hide for this chat »).
- Settings: one switch « Suggest next steps » in Kybernos Settings, on for rules, and an additional « Use the Study model »
  (off). Nothing is stored: the chips are recomputed from the answer, cached by message id for the session only.
- Privacy: B sends the answer's tail to the Study model only, and the Study model is the one the person already chose (or a local
  one). No new third party. The prompt is the host's, fixed; the answer text is data inside it, quoted.

## Where it renders, concretely

`KbNextSteps` registered in `conversation.input.dock` at order 20 (before the newchat cards, which only show in an empty chat, so
they never meet). Same inset as the starters (`padding: 0 16px 10px`), tokens only, a 40 px target (44 on touch, as the page buttons
of the mobile layout), class prefix `kbns-` (a prefix nobody else uses; the class collisions of the audit, A1-04, are the reason to check).

## Cost of building

- A: `next-steps.mjs` (pure, rules, tested with real answers), the chip component, the switch: about a day.
- B: a host route `/kybernos/next-steps` on the model of `starters-suggest` (prompt builder, JSON parse, timeout 20 s, `maxTokens 120`,
  rate limit), the switch, tests with a fake `llm.stream`: about two more days.
- Neither needs a new seam or an engine patch.

## Open questions for the owner

1. Rules only for now, or rules and the Study model together? (proposed: rules, then the model behind a switch.)
2. Languages: the chips follow the answer's language (the model is told to), the rules need French and English phrasings;
   the other packs fall back to English.
3. Should suggestions also appear after an **automation** run, in the run's session? (proposed: no, nobody is there to click.)
