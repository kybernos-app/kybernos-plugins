# Running a chat on the Cloud Computer — what exists, what does not

The new-chat page shows the Cloud Computer and can wake it, put it to sleep and open it (`/kybernos-cloud/computer/{resume,suspend,open}`).
The composer's environment popover lists it as **« Cloud Computer », disabled**, with its reason. This page is why it is disabled, and the
smallest change that would enable it. Checked on 2026-10-15 in the server's code (`kybernos-server`, ADR 0052 and 0053).

## What exists

| Door | What it runs | Who can start it |
|---|---|---|
| Telegram | a **turn** addressed to the person's Home computer: the channels module calls `hosted.dispatch(userId, kyberId, { threadId, message, clientTurnId, computerId, source: 'telegram' })`; the computer's runner takes the job (`services/computer-image/runner.mjs`), its own DSH answers, the answer goes back to the chat | the person, in the bot's chat; **behind the owner's switch `channel_computer_turns_enabled`** (0 by default) |
| Schedule | an automation already on the computer (`tasks.json`), at its time | nobody; the platform wakes the computer (`next_wake_at`) |
| Webhook | `POST /v1/hooks/{hook_id}?secret=…` → the platform wakes the computer if needed and forwards to its `/kybernos/hooks`, which runs **an existing automation** with the event appended to its prompt | whoever holds the secret |
| Page | the computer's own DSH, opened by a single-use ticket (`POST …/computers/{id}/ticket`) | who may open it (its owner; owners and admins when its access allows) |

## What does not exist

- **The public dispatch route takes no computer.** `POST /v1/kybers/{id}/threads/dispatch` (`hosted/routes.ts`) takes `thread_id`, `message`,
  `client_turn_id`, `model`. The service behind it already knows `computerId` (it checks `computerServes(userId, workspaceId, computerId)`
  and runs the turn on that computer instead of a platform runner), but only the channels module passes it.
- **No route writes to a computer's `tasks.json`.** An automation exists on a computer because the person made it in its page.
- **DSH has no server-side conversation.** The route works on a *thread* (« one of your conversations with this kyber »); a DSH chat is a local
  session.

So a DSH chat cannot be sent to the Cloud Computer today, and the composer says so instead of hiding the computer.

## The smallest change (not built)

1. **Server**: an optional `computer_id` in the body of `POST /v1/kybers/{id}/threads/dispatch`, passed to `service.dispatch` as `computerId`.
   Everything else is the path Telegram already uses: the same job, the same tool gate, the same approvals, the same owner switch.
2. **DSH host** (`kybernos-cloud`): `POST /kybernos-cloud/computer/turn` — strict same origin, the body is the prompt only; the host finds
   the Home computer (as for wake, sleep and open), keeps one thread with the person's kyber for this, dispatches, and relays the answer
   by reading the thread, bounded.
3. **DSH page**: the option becomes selectable when the computer is awake or asleep (a wake is part of the turn). The turn is sent from the
   composer and its answer is shown as the answer of another machine; it does not make a local session.
4. **Decisions that are the owner's**: whether such a turn counts against the run hours or the credits (ADR 0052 § 23); whether it is
   offered on every plan; what an approval looks like when the person is in DSH rather than in Telegram; and the owner's switch itself.

Rejected: a webhook automation seeded on the image to run « whatever the event says » — it turns the event into instructions, which is
what the webhook prompt is built to prevent (`kbHookPrompt`), and the hook secret would have to be kept on this computer.
