# Running a chat on the Cloud Computer — what exists, what does not

The new-chat page shows the Cloud Computer and can wake it, put it to sleep and open it (`/kybernos-cloud/computer/{resume,suspend,open}`).
The composer's environment popover lists it as **« Cloud Computer », disabled**, with its reason. This page is why it is disabled, and the
smallest change that would enable it. Checked on 2026-10-15 in the server's code (`kybernos-server`, ADR 0052 and 0053); re-checked on 2026-10-24 against its `origin/dev`: what moved is marked below.

## What exists

| Door | What it runs | Who can start it |
|---|---|---|
| Telegram | a **turn** addressed to the person's Home computer: the channels module calls `hosted.dispatch(userId, kyberId, { threadId, message, clientTurnId, computerId, source: 'telegram' })`; the computer's runner takes the job (`services/computer-image/runner.mjs`), its own DSH answers, the answer goes back to the chat | the person, in the bot's chat; **behind the owner's switch `channel_computer_turns_enabled`** (0 by default) |
| Schedule | an automation already on the computer (`tasks.json`), at its time | nobody; the platform wakes the computer (`next_wake_at`) |
| Webhook | designed (ADR 0052), **not served yet**: the console mints the URL `POST /v1/hooks/{hook_id}?secret=…`, but no server route answers it (2026-10-24). The receiver on the computer, `/kybernos/hooks`, exists: it runs **an existing automation** with the event appended to its prompt | whoever holds the secret, once the ingress is served |
| Page | the computer's own DSH, opened by a single-use ticket (`POST …/computers/{id}/ticket`) | who may open it (its owner; owners and admins when its access allows) |

Since 2026-10-15 the public dispatch route takes a computer: `POST /v1/kybers/{id}/threads/dispatch` (`hosted/routes.ts`) accepts an optional
`computer_id` besides `thread_id`, `message`, `client_turn_id`, `model`, passes it to the service as `computerId` (which checks
`computerServes(userId, workspaceId, computerId)` and runs the turn on that computer instead of a platform runner), and answers
`computer_unavailable` for one that is not the person's or cannot take a turn.

## What does not exist

- **No route on `origin/dev` writes to a computer's `tasks.json`.** The outbox (`PUT/GET /v1/workspaces/{id}/computers/{id}/tasks`) is on
  the pushed branch `feature/computers-page-and-outbox`, not merged. An automation exists on a computer because the person made it in its page.
- **DSH has no server-side conversation.** The route works on a *thread* (« one of your conversations with this kyber »); a DSH chat is a local
  session.

So a DSH chat cannot be sent to the Cloud Computer today, and the composer says so instead of hiding the computer.

## The smallest change (step 1 done, steps 2 to 4 not built)

1. **Server** (done 2026-10-15): an optional `computer_id` in the body of `POST /v1/kybers/{id}/threads/dispatch`, passed to `service.dispatch` as `computerId`.
   Everything else is the path Telegram already uses: the same job, the same tool gate, the same approvals, the same owner switch.
2. **DSH host** (`kybernos-cloud`): `POST /kybernos-cloud/computer/turn` — strict same origin, the body is the prompt only; the host finds
   the Home computer (as for wake, sleep and open), keeps one thread with the person's kyber for this, dispatches, and relays the answer
   by reading the thread, bounded.
3. **DSH page**: the option becomes selectable when the computer is awake or asleep (a wake is part of the turn). The turn is sent from the
   composer and its answer is shown as the answer of another machine; it does not make a local session.
4. **Decisions that are the owner's**: whether such a turn counts against the run hours or the budget (ADR 0052 § 23); whether it is
   offered on every plan; what an approval looks like when the person is in DSH rather than in Telegram; and the owner's switch itself.

## Step 3 has no seam yet (checked 2026-11-03)

Making the option selectable is the easy half; **diverting what the person types is not**. Read in the installed engine (0.2.2-alpha.2, `dsh-client-ui-conversation` types):
the composer's submit is *adjudication* (a `/` line is offered to the input-trigger sources) and then the *default sink*, which is « the plain-message sink (send
choreography / materialize fork — the hub owns it) ». A plugin may claim a **`/` line**, never a plain message, so no plugin seam turns « Enter » into « send to that
computer instead ». A capture-phase listener on `[data-composer-input]` would do it by DOM (the slash bundle already reads that node), but it would be a hack that breaks with
the engine's markup, and AGENTS.md rule 1 asks for seams. Three ways forward, none built:

1. **A `/cloud` command** (an input-trigger source, like the slash bundle's): `/cloud <message>` or `/cloud <computer> <message>` goes to the host's turn route; the
   selector lists the computers and fills the prefix. Inside the seams, honest about what it does, less magical than a mode.
2. **A panel above the composer** (`conversation.input.dock`) with its own box « Ask <computer> » and the answer shown there. Inside the seams, but two input boxes.
3. **Ask the engine for a sink seam** (a registered sink that may take a plain message when a plugin says so). The clean answer, and an engine change.

Whatever is chosen, the host half is the same and is still to write: `POST /kybernos-cloud/computer/turn` (`{ computer_id, text }`) reads Kaby's `kyber_id` and `thread_id`
from `GET /v1/me/kyby`, dispatches `POST /v1/kybers/{kyber_id}/threads/dispatch` with `computer_id` and a `client_turn_id`, and the answer is read back from
`GET /v1/threads/{thread_id}/messages` (bounded). The server also refuses with `extra_cap_exhausted` (402) when the member's extra budget is used (kybernos-server ADR 0066)
The Telegram door is behind the owner's switch `channel_computer_turns_enabled`; whether the public dispatch route is too is to read in the server before relying on it.

Rejected: a webhook automation seeded on the image to run « whatever the event says » — it turns the event into instructions, which is
what the webhook prompt is built to prevent (`kbHookPrompt`), and the hook secret would have to be kept on this computer.
