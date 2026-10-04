# `@local/kybernos-flow`

Two conversation-flow features that used to be engine patches and are now plugin code: an automatic
"continue" when a turn is cut by the output-token limit, and drag-to-reorder for queued messages.

## What the user sees

- **Auto-continue**: no screen. When a turn ends with reason `max-tokens`, the plugin queues a user message
  `continue`, which opens one more turn (the old patch extended the same turn). At most 3 times in a row by
  default. It leaves lines starting `[kybernos-flow]` in the host console.
- **Queue reordering**: in the native queue dock (`[data-queue-dock]`), when two or more messages are
  waiting, each row gets a six-dot handle on hover or focus. Drag it, or press Alt+Up / Alt+Down on it. A
  status line ("Reordering unavailable." or "Could not reorder this message.") shows for 3 s on failure.
  No handle is drawn unless the host reports the move as supported.

## Host route

`/kybernos/queue-move`, JSON, `Cache-Control: no-store`:

- `GET ?sessionId=` returns `{ok, supported, items: [{id, lane, index, preview}], reason?}`. It is the
  capability probe: `supported: false` with `session-not-live` or the canary's reason. An `Origin` or
  `Referer` that is present must be the socket's own loopback `host:port`.
- `POST {sessionId, messageId, beforeId | null}` moves a message just before another, or to the end, inside
  its own lane. It needs `Origin` or `Referer`, `application/json` and a body of 4 KB or less. Answers
  `{ok, deplace}` or `{ok: false, error}`: 501 `unsupported`, 404 `not-found` / `anchor-not-found` /
  `session-not-live`, 409 `cross-lane`, 400 bad ids or body, 403 origin, 415, 405.

## Files, settings, environment

No file read or written, no setting; per-session counters live in memory. Env: `KYBERNOS_AUTO_CONTINUE_MAX`,
read at each turn end (default 3; `0`, a negative or a non-numeric value disables it). The client reads
`localStorage['dsh.sessions.current']` as a fallback to find the current session id.

## DSH seams and network

- Auto-continue: events `session/event` (`turn/end`), `agent/inbox/inserted` and `agent/disposed` on `ctx`,
  service `agents` (read lazily with `ctx.get`), then `agent.followup(message)`. Nothing is injected if
  `agent.inbox.hasPending` is true, and the counter resets on any other turn end or user message. The message
  is built by hand in the shape of `createUserMessage`; no `@deepseek-ai/*` import.
- Queue move: `webServer` and `agent.inbox.mutate(target, start, deleteCount, inserted, false)`. That method
  is internal to the engine and not part of the public inbox contract: a runtime canary (method present,
  arity 5, `nextTurn` and `nextStep` arrays) turns the route into 501 if the engine changes it. The comments
  record it as measured on 0.2.0-rc.2 and 0.2.1-alpha.1; `dsh-compat.json` stops at 0.2.0-rc.2.
- Client: `inject: ['uiWorkspace']` (session id from `mainReference` or `selection`). The handle is DOM
  decoration on `[data-queue-dock]` and the `_pendingRow` / `_preview` class suffixes.
- Patch debt: `scripts/patches.json` retires the legacy `queue-move` patch from engine 0.2.0-rc.2 because this
  bundle suffices there (measured in the real GUI on 03/10/2026). It stays applied on 0.1.6 and 0.1.7,
  where this bundle was not measured.
- Network: none beyond same-origin `/kybernos/queue-move`. No `remote.*`.

## Tests

```bash
node test-host.mjs     # 77 checks; add --engine <path to dsh-agent-loop/lib/index.js> for the real inbox pass
node test-client.mjs   # 25 checks; the DOM gesture pass runs only if jsdom resolves (KYBERNOS_JSDOM)
```

Host: cap parsing, message shape, the continue state machine, the canary, the move gesture, the route and
both origin guards, all on stand-ins. Client: pure functions (drop target, host/DOM reconciliation, preview
match). Without the two optional inputs those passes are reported "non jouée", not as failures.

## Known limits

- The client reconciles only the `next-turn` lane with what is on screen; a stale or mismatched queue sends
  nothing.
- Only a live session is movable: otherwise the probe says `supported: false` and no handle appears.
- Client strings are French unless the language resolves to `en`. `index.js` points to
  `docs/handoff/zero-patch-moteur.md`, which is not in this repo.
