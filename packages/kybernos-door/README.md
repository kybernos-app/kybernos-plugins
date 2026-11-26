# Kaby MCP (`kybernos-door`)

Claude Code (or any MCP client) on **this computer** gives your Kaby a task and reads its answer. It is the same idea as the assistants'
door of the Kybernos server (`kaby_do`, [`docs/dev/mcp-kaby-contract.md`](../../docs/dev/mcp-kaby-contract.md)), without the cloud: the
task runs in **this** DSH, as a new conversation of your Kybernos, **put under "ask first"** before anything is sent to it.

Off by default (Suite › Plugins). No engine patch: it is one plugin route and the engine's own `sessionController` and
`sessionPersistence` services.

## Connect an assistant

The assistant must run **on this computer** (Claude Code, Codex, another that can add an MCP server). Claude Cowork and claude.ai work from the
cloud and cannot reach this computer: for them, use Kaby MCP with a cloud computer.

1. Switch the module on in Suite › Plugins and restart Kybernos. The plugin makes a secret token in your profile.
2. Open **Settings › Kaby MCP** (`client.js`). Press **Copy the message** and paste it into your assistant: it adds the MCP server with its own
   tools, so nothing here is specific to one assistant. The message carries the address and the PLACE of the token file, never the token.
3. The page says when an assistant has connected ("Last call 2 min ago", read from the last authenticated call).
4. Ask your assistant to have Kaby do something.

Doing it by hand is in the fold of the same page (a snippet for Claude Code, Codex and a generic JSON file, the address, a button that copies the
token without showing it, and a button that changes it). The same from a terminal: `node scripts/door-local.mjs` prints the Claude Code command
with the token in it (keep it to yourself); `--port N` if your Kybernos is not on 3080; `--check` asks the running door for its tools (it sends the header `x-kaby-check`, so the page does not count it as an assistant connecting);
`--rotate` makes a new token. The old token stops working at once (it is read again at every request).

The page's own routes (`setup.mjs`) are `GET /kybernos-door/setup`, `POST /kybernos-door/setup/token` and `POST /kybernos-door/setup/rotate`.
They are for the page, not for assistants: each needs the right Origin and DSH's signed browser session (`session-guard.mjs`, the copy every
bundle that guards a write carries).

## The tools

| Tool | What it does |
|---|---|
| `kaby_do { task, idempotency_key?, wait_seconds? }` | starts a task (a new conversation in Kybernos) and waits up to `wait_seconds` (default 30, at most 45) for the answer |
| `kaby_do { task_id, wait_seconds? }` | comes back to a task: waits for it, starts nothing |
| `list_tasks { limit? }` | the tasks given through this door, most recent first, and whether each is still going |
| `kaby_stop { task_id }` | stops a task that is going: Kaby and the agents it started are cancelled at once, what waits in their queues is removed, and the id then says `canceled`. A finished task is not touched; what a stopped task already did is not undone |

A task has a status: `done` (with its `answer`), `running` (call again with the `task_id`), `waiting_approval` or `waiting_answer` (Kaby is
asking you something on the Kybernos screen), `canceled` (after `kaby_stop`), or `failed` (with a `reason` code: `model_429`, `no_answer`, …).

## What it can and cannot do

- **It cannot approve anything.** A step that needs a human yes waits for you on the Kybernos screen; the door only reads that it is waiting.
- **A task always asks first.** Before the task is sent, the session is put under the asking permission preset (the same one an automation set to
  "ask" gets), whatever your profile's default is (it may be one that never asks), and a call to an outside app that may write (send, delete, pay)
  waits for you too, worded as "Task from an outside assistant". The core plugin (`kybernos-plugin`) does this through its `kybernos.askSessions`
  seam; if the seam is missing, or no preset asks for approval, the task is **not started** and the assistant is told `approvals_unavailable`.
- **It gives Claude Code nothing new on the machine** Claude Code does not already have (it can already run a shell), but it does give it
  Kaby's connected apps, memory and skills: that is the point, and the reason the door is off until you switch it on.
- **The task text is yours, relayed.** It is sent as written, with nothing added.

## How it is fenced

DSH serves plugin routes before its own sign-in, so the route is its own fence (`door-http.mjs`): the `Host` header must be this listener's own
loopback address (a DNS-rebinding page fails), there must be **no** `Origin` header (a browser always sends one; Claude Code sends none), and
the `Authorization: Bearer` token must match, compared in constant time. With no token on disk the door answers 503 and nothing else.
The route audit (`node scripts/audit-routes.mjs`) classes it `closed`, so it needs no entry in the route exceptions.

## What it stores, and where

`<DSH home>/kybernos/door/token` (the secret), `tasks.json` (task id → session, 200 tasks, 7 days) and `activity.json` (the time of the last call, nothing else): all `0600`, written atomically,
never fatal (a file that cannot be written means the task is not started, never a crash).

## Not built (said here so nobody assumes it)

- Starting one of your **automations** and reading a run (`run_automation`, `get_run`, `list_runs` of the server door): they need the
  assistant-callable seam of `docs/dev/mcp-kaby-contract.md`, which does not exist in this repository yet.
- A Journal link for a task.
- A one-press button per assistant (Claude Code, Codex): each has its own command and changes it, so the pasted message is the way for now.
- Stopping a task from the assistant: stop it in Kybernos.
- A client other than one that sends `Authorization` headers; OAuth is the server door's, not this one's.

## Tests

`node test-door.mjs` (no DSH, no network beyond a loopback listener on a free port, and a temporary profile).
