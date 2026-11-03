# Running a chat on the Cloud Computer — what exists, what does not

The new-chat page shows the Cloud Computer and can wake it, put it to sleep and open it (`/kybernos-cloud/computer/{resume,suspend,open}`).
Since 2026-11-03 the composer's environment menu also lists the person's cloud computers and **lets them choose one, like E2B** (see « How it is built » below):
the chat stays a local session, and the agent hands missions to that computer. Checked on 2026-10-15 in the server's code (`kybernos-server`, ADR 0052 and 0053); re-checked on 2026-10-24 against its `origin/dev` and on 2026-11-03: what moved is marked below.

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

So a DSH chat cannot be *moved* to the Cloud Computer (its messages are not a server thread). What can be done is to hand it **missions**: each one is a message of
the person's own Kaby conversation, addressed to the chosen computer. That is what is built.

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

## How it is built (2026-11-03): the E2B way, because no plugin can take over « Enter »

The engine gives a plugin no way to divert what is typed in the composer (checked in 0.2.2-alpha.2, `dsh-client-ui-conversation`): the submit is *adjudication* (a `/` line goes to
the input-trigger sources) and then the *default sink*, which the hub owns. So nothing here pretends to turn « Enter » into « send to that computer ». The E2B selector shows
the way, and the cloud computer follows it:

- **The menu** (`kybernos-computers/client.js`, `EnvSelector`): one row per cloud computer of the person (the list the Automations page draws, `GET /kybernos-cloud/computers`),
  with its state in words; awake or asleep can be chosen (the server wakes a sleeping one for the task), one being set up or off cannot. Choosing a row stores it in the host;
  choosing « This machine » or E2B clears it, and choosing a cloud computer puts E2B off. A computer that left the list clears the choice.
- **The choice** (`kybernos-cloud/index.js`): `GET /kybernos-cloud/computer/target` and `POST /kybernos-cloud/computer/target/set` (`{ computer_id, name }`, or `{ computer_id: null }`),
  kept in `kybernos-cloud-computer.json` in the DSH home (mode 0600). The write needs the same session cookie and origin as every write of the bundle.
- **The prompt section** `kybernos:cloud-computer-target` (order 8710, after E2B's 8700): empty while nothing is chosen, so a chat that never chose one is unchanged. Chosen, it
  tells the agent where the person wants their work done and to use the tool below, unless the person says otherwise or the work only touches files on this machine.
- **The tool** `cloud_computer_task` (`kybernos-cloud/computer-turn.mjs`): one parameter, the mission (the model never names a computer, the person chose it). It reads Kaby's
  conversation (`GET /v1/me/kyby`), dispatches `POST /v1/kybers/{kyber_id}/threads/dispatch` with the `computer_id` and a fresh `client_turn_id`, and reads the answer back from
  `GET /v1/threads/{thread_id}/messages?after=<position>` for about two minutes. A task still running is said so (« its answer will arrive in your Kaby conversation ») and is
  never sent twice.
- **Refusals in words**: `extra_cap_exhausted` (the member's extra budget, kybernos-server ADR 0066), `insufficient_quota`, `feature_not_in_plan`, `computer_unavailable`, `turn_pending`,
  `personal_workspace`, `rate_limited`, `hosted_busy`, `queue_full`. The server decides everything that is a decision (plan, budget, extra budget, waking); the host carries and bounds.

What is **not** known: the public dispatch with a `computer_id` is not behind the owner's switch `channel_computer_turns_enabled` (that one is read by the messenger module only, `channels/service.ts`;
the hosted service checks the plan's `feature_not_in_plan` and `computerServes`). Read in the code on 2026-11-03, **not run against a real server and computer**: the first live turn is the check. Not built: sending
a document to the computer (the dispatch carries text only; a document needs a server feature).

Rejected: a webhook automation seeded on the image to run « whatever the event says » — it turns the event into instructions, which is
what the webhook prompt is built to prevent (`kbHookPrompt`), and the hook secret would have to be kept on this computer.
