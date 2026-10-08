# `@local/kybernos-call` (`packages/kybernos-call`)

Voice calls from a chat session: a LiveKit room, a listening worker (Python) started by the host, and a call panel in the
browser. What is heard is sent back to the session as a real DSH turn ("the call IS the discussion").

Split out of the core bundle (`@local/kybernos`) on 2026-10-08, **moved as is**: same behaviour, new home. The design
work that follows (the call belongs to the session, a team member is an optional speaker, one brain, languages, a voice
engine for cloned voices, an animated face) is not here yet.

## Where to find it

The **Call** and **Video** buttons on a team member's card (the crew view of `@local/kybernos`). That card talks to this
bundle through one seam, `window.__KB_CALL__.open({ sessionId, kyberId, roleId, name, mode })`. Without this bundle the
seam does not exist and the two buttons are hidden.

## What it does

1. `POST /kybernos-call/token` returns a LiveKit room-join token (an HS256 JWT forged with `node:crypto`), starts the worker if it
   is not running, waits for it to register, and wakes it on the new room by explicit dispatch (`agent_name = kybernos-appel`).
2. The browser loads the LiveKit SDK (`/kybernos-call/vendor/livekit-client.js`, 2.22.3, Apache-2.0, at the first call only),
   joins the room, publishes the microphone and attaches the tracks it receives.
3. The worker (`agent/agent.py`) listens (Groq Whisper), answers by voice (a small Groq model, macOS `say` or Groq TTS) and
   POSTs every sentence it heard to `/kybernos-call/utterance`, which sends it to the session (`session/prompt`).

## Host routes

| Route | Method | Notes |
|---|---|---|
| `/kybernos-call/status` | GET | what is true of the chain (secrets set or not, face provider); never a secret |
| `/kybernos-call/token` | POST | same origin only; the body carries `sessionId`, `kyberId`, `identity` |
| `/kybernos-call/agent` | POST | same origin only; `{ action: 'start' \| 'stop' \| 'status' }` |
| `/kybernos-call/utterance` | POST | same origin only; `{ sessionId, text, mode: 'queue' \| 'steer' }` |
| `/kybernos-call/vendor/livekit-client.js` | GET, HEAD | the SDK, served as is |

DSH serves plugin routes before its own sign-in, so the three POST routes refuse any request that does not come from the
page's own origin (checked against the socket's real port, never the `Host` header).

## What it stores, and where

Nothing new: it reads and writes in the folders it already used, under `$DSH_HOME` (else `~/.dsh`):

- `kybernos/livekit.env` (chmod 600): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GROQ_API_KEY`, and for the
  face `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID` (`LIVEAVATAR_SANDBOX=1` for the free 60 s sandbox).
- `kybernos/logs/appel-agent.log` and `appel-agent.json`: the worker's log and its per-call marks.
- `kybernos/appel-venv/`: the worker's Python environment (`uv venv` then `uv pip install -r agent/requirements.txt`).

These names keep their French `appel` on purpose: a machine that already has a working venv keeps working. They move under
`kybernos/kybernos-call/` in a later step, with a migration.

It also reads `$DSH_HOME/.credentials.yaml` (the `client-connection/browser-session` secret) to sign a local `dsh-auth-*` cookie
and call `session/prompt` on `127.0.0.1:$DSH_WEB_PORT`; the same technique as `scripts/dsh-relance.mjs`.

## Outbound

LiveKit (the room URL in `livekit.env`), and from the worker: Groq (listening, answering, optional TTS) and LiveAvatar (the
face). Nothing else, and nothing at all until a call starts.

## Changed while moving

Behaviour is the same, except for what was broken or dead:

- **The worker is now really started detached with its output in the log.** `execFile` ignores `detached` and `stdio`: the log was
  never written (the host waited its whole 12 s budget for a "registered worker" line it could not see) and a long-running worker
  would have been killed at 1 MB of output. It uses `spawn` now, and creates the log folder. Proved with a real child process
  (`test-agent-process.mjs`: 12 s and a missing log before, 0.8 s after).
- "Mute me" is a toggle (it only ever muted), and the call clock ticks while the call is live.
- The unpkg fallback for the SDK is gone (the SDK ships with this bundle, and a call must not load a script from a third party).
- Host error messages are in English; the panel text is French and English.

## Known limits (from reading the code, not yet measured on a live call)

- The worker is started once and keeps the session and kyber of the FIRST call (`KYBER_SESSION_ID`, `KYBER_ID` are set in its
  environment). A later call from another session injects into the first one.
- The client sends no member and no mode: every member sounds the same, the language is `fr`, the voice comes from an
  environment variable.
- The voice that speaks is a separate small model; DSH's own answer is not spoken.
- macOS only for the local TTS (`say`), and `pgrep` / `kill` are Unix.

## Tests

`node packages/kybernos-call/test-host.mjs`, `test-routes.mjs`, `test-client.mjs`, `test-dsh-home.mjs`, `test-agent-process.mjs` (a real child process, Unix only). None needs DSH, a browser
or the network. A real call needs a microphone and the keys above: run it on the sandbox instance (`scripts/sandbox/`), never
on the owner's own GUI.
