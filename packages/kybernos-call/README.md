# `@local/kybernos-call` (`packages/kybernos-call`)

Talk to your assistant, or to a member of your team, out loud, from any chat session. A LiveKit room carries the voice, a
listening worker (Python) started by the host hears you, and what it hears becomes a **real turn of the session**: the
session's own model, tools and permissions answer, and that answer is what the call speaks.

It was split out of the core bundle (`@local/kybernos`) on 2026-10-08; the core keeps only the two buttons of a member card, which
reach this bundle through one seam.

## Where to find it

- **The Call button in the composer** of every session (the dock under the message box): the call belongs to the session, not to a team.
  It calls the session's assistant, with the voice, language and mode of Settings › Calls.
- **Call / Video on a team member's card** (the crew view of `@local/kybernos`): that member, with its own voice. These two buttons
  call `window.__KB_CALL__.open({ sessionId, kyberId, roleId, name, mode, voice })`; without this bundle the seam does not exist and
  the buttons are hidden.
- **Settings › Calls**: Essentials (the assistant's voice, the call language, the default mode, when a call hangs up by itself, whether
  recordings may be sent to the clone provider), Engines (what a call uses, read only) and Service (the keys, with a test button each).

## First call

1. Settings › Calls › Service: the LiveKit address, key and secret (a free LiveKit Cloud project is enough), and the Groq key
   (listening). Each has a **Test** button. Keys are written to `kybernos/livekit.env` (private file) and are never shown again.
2. The worker's Python environment, once: `uv venv ~/.dsh/kybernos/appel-venv && uv pip install --python ~/.dsh/kybernos/appel-venv/bin/python -r agent/requirements.txt`
   (under `$DSH_HOME` if set). The host starts the worker itself at the first call.
3. Click Call. Allow the microphone. Speak.

A face (a `video` call) needs a LiveAvatar key and avatar id (Service tab); without them the call stays voice only. A member's own voice
needs nothing: it is the one chosen on its card. A voice made from a recording needs an ElevenLabs key and the switch in Essentials.

## How a call works

1. `POST /kybernos-call/token` returns a LiveKit room-join token (an HS256 JWT forged with `node:crypto`), starts the worker if it is not
   running, waits for it to register, and wakes it on the new room by explicit dispatch (`agent_name = kybernos-appel`).
   **Who the call is with travels with the room**: the dispatch metadata carries `{ sessionId, kyberId, roleId, name, mode, language,
   voice, brain, limits }`, each field checked by the host (`callMetadata`). The worker serves many rooms, so none of it lives in its
   environment. What a surface does not say (mode, language, the assistant's voice) is filled from the settings.
2. The browser loads the LiveKit SDK (`/kybernos-call/vendor/livekit-client.js`, 2.22.3, Apache-2.0, at the first call only), joins the
   room, publishes the microphone and attaches the tracks it receives.
3. The worker (`agent/agent.py`) reads the metadata (`agent/call_meta.py`), listens (Groq Whisper, in the call's language, or detecting
   it when it is `auto`), shows a face only on a `video` call, and POSTs every sentence it heard to `/kybernos-call/utterance`, which sends
   it to THAT call's session (`session/prompt`). If a turn of the session is already running, the words go in as `steer` (they correct
   it); otherwise they queue.
4. **One brain.** With a session behind the call (`brain: session`) the worker's small model does NOT answer (`StopResponse`). The host
   listens to the engine's `session/event` stream (`speech-feed.mjs`) and keeps, for the call's room, what the session's assistant writes;
   the worker long-polls `GET /kybernos-call/speech` and speaks it (`speakable()`: code, tables, links and markup stay in the thread, the
   rest is cut at a sentence end under 700 characters). If the session is still working after a few seconds, the voice says one short
   "one moment" in the call's language. Without a session, or on an engine with no event stream, the small model answers, so a call is
   never silent.
5. **The app's voice.** The worker speaks through the app's own voice engine (`POST /kybernos/tts/speak` of `@local/kybernos`: the one
   behind the member card's Preview, with its engines, a voice per language, a fallback chain and a cache), with the voice picked on the
   member's card and the language of the reply (`agent/call_voice.py`, `agent/host_tts.py`). The member's voice is kept while it speaks
   the language of the reply (or is multilingual, like Edge's `…MultilingualNeural`); in another language the engine picks a voice of that
   language on the same engine. With the call on `auto` the reply follows the language the user just spoke. macOS `say` stays behind.
6. **A recording as a voice.** If the member's voice is a recording, the host (never the page) reads the recording the app kept, sends it
   once to ElevenLabs (`/v1/voices/add`) and remembers the voice id; the worker then speaks with it (`eleven_multilingual_v2`: any
   language), the app's engine behind it. This happens only if the switch in Essentials is on AND an ElevenLabs key is set: the
   recording leaves the machine, and the settings say so. Without them the member keeps the default voice and the panel says why.
   Deleting the clone (Service tab) removes it at the provider; the original recording stays here.
7. A call hangs up by itself after the silence or the maximum length of Settings › Calls (the worker deletes the room).

## Routes (all under `/kybernos-call/`)

| Route | Method | Notes |
|---|---|---|
| `status` | GET | what is true of the chain (secrets set or not, face provider); never a secret |
| `token` | POST | same origin only; `{ sessionId, kyberId, roleId, name, mode?, language?, voice? }` |
| `agent` | POST | same origin only; `{ action: 'start' \| 'stop' \| 'status' }` |
| `utterance` | POST | same origin only; `{ sessionId, text, mode: 'queue' \| 'steer' }` |
| `speech` | GET | same origin only (it is the session's own text); `?room=&after=&wait=` a long poll; `known: false` once the room is released |
| `settings` | GET, POST | GET: the settings, which secrets are set, the clones. POST (same origin): `{ patch }`, all or nothing |
| `keys` | POST | same origin only; `{ patch: { NAME: value } }` (`''` removes); all or nothing; the answer never repeats a value |
| `test` | POST | same origin only; `{ service: 'livekit' \| 'groq' \| 'elevenlabs' }`: one read-only call, on this click only |
| `clone` | POST | same origin only; `{ rootId, voiceId, name }` creates, `{ action: 'delete', voiceId }` deletes |
| `vendor/livekit-client.js` | GET, HEAD | the SDK, served as is |

DSH serves plugin routes before its own sign-in, so every POST, and the GET that returns session text, refuse any request that does not
come from the page's own origin (checked against the socket's real port, never the `Host` header).

## What it stores, and where (all under `$DSH_HOME`, else `~/.dsh`)

- `kybernos/livekit.env` (chmod 600): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GROQ_API_KEY`, `LIVEAVATAR_API_KEY`,
  `LIVEAVATAR_AVATAR_ID`, `LIVEAVATAR_SANDBOX`, `ELEVENLABS_API_KEY`. Any other line (the worker's `KYBER_*` options, comments) is left
  untouched when the page changes a key.
- `kybernos/kybernos-call/settings.json` and `clones.json` (chmod 600): the settings; the clones (a recording id → a provider voice id; no key).
- `kybernos/logs/appel-agent.log` and `appel-agent.json`: the worker's log and its per-call marks.
- `kybernos/appel-venv/`: the worker's Python environment.

The `appel` names are kept on purpose: a machine that already has a working worker keeps working. It also reads
`$DSH_HOME/.credentials.yaml` (the `client-connection/browser-session` secret) to sign a local `dsh-auth-*` cookie and call
`session/prompt` on `127.0.0.1:$DSH_WEB_PORT`; the same technique as `scripts/dsh-relance.mjs`.

`KYBER_TTS` in `livekit.env`: unset, `say` (the old default) or `app` use the app's voice engine; `groq` forces Groq's voice (English and
Arabic only); `legacy` forces the old local `say` voice only. A hand-started worker (no dispatch metadata) still reads `KYBER_SESSION_ID`,
`KYBER_ID`, `KYBER_VISAGE`, `KYBER_LANGUAGE`, `KYBER_INSTRUCTIONS` from its environment.

## Outbound

LiveKit (the room URL), and from the worker: Groq (listening, and the small model when there is no session), LiveAvatar (the face),
ElevenLabs (only for a cloned voice). From the host: ElevenLabs (only to clone or delete a voice, and only if the user allowed it), and
Groq / ElevenLabs / LiveKit when the user clicks a Test button. The voice itself goes through the app's own engine on this machine
(`127.0.0.1`), which sends the text to Microsoft only if the engine chosen is Edge. Nothing at all happens until a call starts or a
button is clicked.

## Known limits

- **Proved, not run with a real model and a microphone.** Everything is covered by tests and by checks on a real DSH (a sandbox): the
  routes, the settings page, the composer button, the member cards, the voice engine and the session events. A full call with real
  speech, a real model's answer and the voice playing in a browser needs your keys and a microphone: that is the one thing not done.
- ElevenLabs cloning is written from the provider's published API (create `POST /v1/voices/add`, speak `POST /v1/text-to-speech/{id}`,
  delete `DELETE /v1/voices/{id}`) and tested against fake servers only. The Test button checks the key; the first real clone is the
  proof. It needs a plan that allows instant voice cloning.
- A reply is spoken sentence by sentence, each one rendered whole by the engine before it plays: the first words wait for the first
  sentence (about a second with a local engine, more with Edge or ElevenLabs).
- Which languages can be spoken depends on the engines the app has: `say` has voices for many languages on a Mac, Piper only the models
  you installed, Edge a great many (online). A language with no voice falls back to the engine's first voice.
- What you say while the session is working is steered into the running turn. How the engine handles `steer` on a turn that has just
  ended was not measured; the worst case is that those words are queued.
- The face is LiveAvatar only (a catalogue avatar). Using a member's portrait, or the MuseTalk worker on Modal, is not built.
- macOS first (`say`, `pgrep`, `kill`); the engines other than `say` need their Python helper.

## Tests

`node packages/kybernos-call/test-*.mjs`: `test-host` (the token, the dispatch, the settings a call uses), `test-store` (settings, secrets,
clones on disk), `test-admin` (the settings page's host side, the clone provider, against fake servers), `test-routes`, `test-speech-feed`,
`test-client` (the panel, the composer button, the clone flow, in a fake browser), `test-dsh-home`, `test-agent-process` (a real child
process, Unix only), `test-agent-meta` (the worker's Python tests through `python3`: `call_meta`, `call_voice`, and the LiveKit-facing worker
which are skipped without the worker's venv; run `<venv>/bin/python agent/test_call_agent.py` to run them). None needs DSH, a browser or the
network. In `@local/kybernos`, `test-call-seam.mjs` checks the member card's side.

On a real DSH (a sandbox: `scripts/sandbox/setup.sh` then `start.sh`, then `source scripts/sandbox/env.sh`):
`scripts/check-call-live.mjs` (the panel), `check-call-ui-live.mjs` (the composer button and Settings › Calls), `check-call-team-live.mjs`
(a team's member cards), `check-call-brain-live.mjs` (the session's events reach the call), `check-call-voice-live.mjs` (the worker asks the
app's real voice engine). A real call needs a microphone: run it on the sandbox, never on your own GUI while it holds a conversation.
