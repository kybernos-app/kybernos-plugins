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
   **Who the call is with travels with the room**: the dispatch metadata carries `{ sessionId, kyberId, roleId, name, mode,
   language }` (each field checked by the host, `callMetadata`). The worker serves many rooms, so none of it lives in its environment.
2. The browser loads the LiveKit SDK (`/kybernos-call/vendor/livekit-client.js`, 2.22.3, Apache-2.0, at the first call only),
   joins the room, publishes the microphone and attaches the tracks it receives.
3. The worker (`agent/agent.py`) reads that metadata (`agent/call_meta.py`), listens (Groq Whisper, in the call's language or
   detecting it when it is `auto`), shows a face only on a `video` call, and POSTs every sentence it heard to
   `/kybernos-call/utterance`, which sends it to THAT call's session (`session/prompt`): a real turn, with the session's model,
   tools and permissions.
4. **One brain.** With a session behind the call (`brain: session` in the metadata) the worker's small model does NOT answer
   (`StopResponse`). The host listens to the engine's `session/event` stream (`speech-feed.mjs`) and keeps, for the call's room, what
   the session's assistant writes; the worker long-polls `GET /kybernos-call/speech` and speaks it (`speakable()`: code, tables,
   links and markup stay in the thread, the rest is cut at a sentence end under 700 characters). Without a session, or on an
   engine that offers no event stream, the small model answers as before, so a call is never silent.

## Host routes

| Route | Method | Notes |
|---|---|---|
| `/kybernos-call/status` | GET | what is true of the chain (secrets set or not, face provider); never a secret |
| `/kybernos-call/token` | POST | same origin only; the body carries `sessionId`, `kyberId`, `identity` |
| `/kybernos-call/agent` | POST | same origin only; `{ action: 'start' \| 'stop' \| 'status' }` |
| `/kybernos-call/utterance` | POST | same origin only; `{ sessionId, text, mode: 'queue' \| 'steer' }` |
| `/kybernos-call/speech` | GET | same origin only (it is the session's own text); `?room=&after=&wait=` a long poll for what the session's assistant wrote for this call; `known: false` once the room is released |
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

## Changed in step 3: one brain

Before, two models answered: a small Groq model spoke at once, while the same words opened a real DSH turn whose answer was never
spoken (the thread and the voice could say different things, and the voice knew nothing of the tools). Now the voice speaks the
session's answer. Proved on a real DSH with `scripts/check-call-brain-live.mjs`: the host follows the engine's session events, and
what a session does reaches the call's room. What was not proved with real audio: a real model answering and the worker speaking it
(needs the LiveKit and Groq keys and a microphone).

## Changed in step 2: who a call is with

- The worker no longer keeps the session and the team of the FIRST call (they were set in its environment when it started, and it
  is started once): a second call from another session wrote into the first one. They are the dispatch metadata of each room now.
- The member and the mode reach the worker: it speaks as the member, and a `voice` call shows no face (a `video` call does, when a
  face provider is set). Before, every call had a face as soon as a provider key was there.
- The language reaches it too: `auto` detects it (Whisper without a forced language) and the voice model is told to answer in the
  language it hears. The French-only brief and the forced `fr` are gone. A hand-started worker (no metadata) still reads
  `KYBER_SESSION_ID`, `KYBER_ID`, `KYBER_VISAGE`, `KYBER_LANGUAGE`, `KYBER_INSTRUCTIONS` from its environment.

## Known limits (from reading the code, not yet measured on a live call)

- Every member has the same voice: it still comes from an environment variable (`KYBER_SAY_VOICE`, `KYBER_GROQ_VOICE`); the
  member's own voice needs a voice engine (not built yet).
- The client always asks for the language `auto`; there is no setting for it yet.
- Hearing is multilingual now, speaking is not: the local voice (`say`, `Thomas`) is a French voice and Groq's TTS only does English and
  Arabic, so a Spanish answer is read with a French accent. A multilingual voice engine is the next step.
- The session's answer is spoken in full only up to ~700 characters (a sentence end); the rest is in the thread. Nothing is said while
  a tool runs (the thread shows it); a spoken "one moment" needs a line per language.
- What you say while the session is still working is queued as a new turn (`mode: queue`), not steered into the running one.
- macOS only for the local TTS (`say`), and `pgrep` / `kill` are Unix.

## Tests

`node packages/kybernos-call/test-host.mjs`, `test-routes.mjs`, `test-client.mjs`, `test-dsh-home.mjs`, `test-agent-process.mjs` (a real child process, Unix only), `test-speech-feed.mjs`, `test-agent-meta.mjs` (the worker's Python
tests, through `python3`; the LiveKit-facing ones are skipped without the worker's venv: run `<venv>/bin/python agent/test_call_agent.py`). None needs DSH, a browser
or the network. A real call needs a microphone and the keys above: run it on the sandbox instance (`scripts/sandbox/`), never
on the owner's own GUI.
