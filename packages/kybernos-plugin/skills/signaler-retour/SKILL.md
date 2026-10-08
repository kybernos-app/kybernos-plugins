---
name: signaler-retour
description: Collects a beta tester's feedback (a bug or an improvement) in three questions, gathers the technical evidence, has the report approved, then sends it through the plugin's tool. Use when the user presses "Send feedback" or asks to report a problem or suggest an improvement.
whenToUse: The user wants to report a bug or suggest an improvement to the Kybernos team.
---

# Report feedback (beta)

You run a short interview, then hand over a report the team can act on. You do not
change any code, you do not propose a pull request, you do not touch any
repository: you collect, you check, you send.

Speak the user's language throughout, whatever language this file is written in.

## 1. Three questions, one at a time

One question per message, then wait for the answer.

1. **The action**: "What were you doing, and what did you expect to happen?"
2. **What happened**: "What happened instead?" If there is an error message, ask
   for it word for word: never guess it.
3. **The impact**: for a bug, "Does it stop you from working, and does it happen
   every time?"; for an improvement, "What would it change for you in practice?"

Do not ask for the version, the OS or a session id: the tool attaches them.
Never ask for a token, a password or a key.

## 2. Check that you understood

Restate it in two sentences: "If I understand correctly: ...". If a detail is
missing for the report to be usable, ask for it now: one question, not three.

If the user asks for an immediate fix: fixing is the team's job and this report is
the way in; offer to finish the interview.

## 3. Preview, then explicit consent

Show EXACTLY what will be sent, in a code block:

- type (`bug` or `feature`) and title (one line, at most 160 characters);
- the body of the report (what you understood, 3 to 8 lines; at most 8,000
  characters: anything longer is cut);
- the technical data attached automatically: DSH version, Kybernos version, OS,
  and the last error only if the user gave one;
- contact: the one the user chose to leave, otherwise none.

Say that nothing else is sent and that no token leaves their machine. Then ask
"Shall I send it? (yes / no)" and WAIT for an explicit yes: a half-hearted "ok" or
a question is not a yes. If the answer is no, ask what to remove and start again
from the preview.

## 4. Sending

Call the `kybernos_signaler_retour` tool with `kind`, `title`, `body`, `errors`
(an array, possibly empty) and `reporter` (empty if the user left no contact).

Then announce the result in one or two plain sentences:

- **success**: give the URL of the issue: "the report is logged, you can open it to
  add a screenshot or a detail". If the tool says it was already sent, say so:
  it is the same report, not a second one;
- **failure**: the tool gives you a reason, a `mailto` link and the full report.
  Say simply what the reason means (the service did not answer, the Kybernos
  session must be reconnected from the account card, ...), offer "Send by mail"
  and then "copy the full report". The report is kept on this machine and is sent
  again by itself with the next report you send, once the service answers: do not
  present the failure as a loss.

If the `kybernos_signaler_retour` tool does not exist (older plugin or host), say
so plainly and give the report in clear, ready to copy, with a `mailto:` link with
no recipient: that is the only fallback.

## Never

- Never create an issue, a PR or a comment yourself: no `gh`, no GitHub API call,
  no `git`.
- Never invent an error message, a version or an identifier.
- Never put a secret, a token or a password in the report, even if the user offers
  one: ask them to remove it before sending.
