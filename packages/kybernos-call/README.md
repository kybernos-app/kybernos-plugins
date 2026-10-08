# `@local/kybernos-call` (`packages/kybernos-call`)

Talk to your assistant, or to a member of your team, out loud, from any chat session. A LiveKit room carries the voice, a
listening worker (Python) started by the host hears you, and what it hears becomes a **real turn of the session**: the
session's own model, tools and permissions answer, and that answer is what the call speaks.

It was split out of the core bundle (`@local/kybernos`) on 2026-10-08; the core keeps only the two buttons of a member card, which
reach this bundle through one seam.

## Where to find it

- **The phone and camera buttons at the top right of the chat** of every session (the header, next to the app's own controls): the call belongs to the session, not to a team.
  The phone starts a voice call, the camera a video call (off, with the reason, until a LiveAvatar key is set). During a call they become one red "Hang up".
  It calls the session's assistant, with the voice, language and mode of Settings › Calls.
- **Call / Video on a team member's card** (the crew view of `@local/kybernos`): that member, with its own voice. These two buttons
  call `window.__KB_CALL__.open({ sessionId, kyberId, roleId, name, mode, voice })`; without this bundle the seam does not exist and
  the buttons are hidden.
- **Settings › Calls**, in three tabs and a "?" that explains each:
  - **Overview**: the five slots of a call (Listen, Think, Speak, Face, Line) with the provider each uses, three presets (Simple, which is
    not wired yet, Live, Best quality), an estimate of the cost per call minute, and the options that are not a provider (the call
    language, small sounds, when a call hangs up by itself). When the user's Models already hold audio models (an ASR, a TTS, a
    realtime one) it says so; using them in calls is not wired yet.
  - **Providers**: one page per provider, drawn from the catalogue (`providers.mjs`): price, where to get a key, its own fields (a key, a
    model, a voice with **Listen**, a face), a **Test** and **Use for calls**. A provider that is only listed ("coming soon") says so and
    offers nothing to fill in.
  - **Health**: one button, **Check everything**: the microphone, the listening key, a sentence through the voice engine, the face
    account, the LiveKit line and the call engine, each with a sentence that says what to do. A missing call engine can be **installed in
    one click**.
- **The setup assistant**: a call asked on a machine with nothing set up (no LiveKit keys), or with keys but never through it, opens a
  four-screen dialog instead of failing: the microphone (a bar that moves), a preset, the keys the preset needs (each with its link and
  test), a final check. It then makes the call that was asked for ("Skip and call" on the first screen goes straight on when the keys are
  already there). A gear next to the phone and camera at the top right of a chat opens it at any time, and so does the button in Settings › Calls.

## The audio models you already have

The Models page lists models. The core (`@local/kybernos`) reads that list and sorts the audio ones by what their names say (`audio-models.mjs`:
`listen`, `speak`, `realtime`), whichever provider they come from, and then finds **how each one is asked** (`audio-probe.mjs`): a gateway TTS
that wants the text as an *assistant* message, a gateway ASR that wants the audio alone, OpenAI's own `/audio/speech` and `/audio/transcriptions`,
DashScope's realtime socket (it answers `session.created`). It sends a few words, or a speaking model's sentence to a listening one, with the key the
app already holds for that provider; the key never leaves the process. What it found is remembered (`models-audio.mjs`) and looked for again
once if it stops working.

- **Speak**: the core has a `models` voice engine, so a speaking model is a voice like any other (the member card, Listen in Settings, and a call).
  A model that needs a reference voice or a description (`voiceclone`, `voicedesign`) is listed but not used yet.
- **Listen**: the provider **A model from your Models** (the worker's `HostSTT` sends each sentence to the host, which asks the model), or **App
  dictation** (the model the app's microphone button already uses).
- **Realtime** models are detected and their connection checked ("Check these models" on the Overview); using one as the whole call is not built.
- Measured on the user's own plans (2026-10-08): a Xiaomi MiMo TTS and ASR work end to end, but a gateway TTS takes 4 to 8 s per sentence and the
  ASR mishears French (the app's own dictation did better), so for live calls Edge, Piper or Groq are faster; Qwen's TTS has no HTTP way found
  (it probably speaks over the realtime socket), and its ASR is the app's dictation.

## First call

1. Click the phone at the top right of a chat. On a machine with nothing set up the setup assistant opens: follow its four screens.
   By hand, the same things are in Settings › Calls › Providers: the LiveKit address, key and secret (a free LiveKit Cloud project is
   enough), and the Groq key (listening). Each has a **Test** button. Keys are written to `kybernos/livekit.env` (private file) and are
   never shown again.
2. The worker's Python environment, once: Settings › Calls › Health › **Install in one click** (it runs `uv venv` and `uv pip install -r
   agent/requirements.txt` for you, under `$DSH_HOME/kybernos/appel-venv`; with no `uv` it uses a Python 3.10+, and with neither it says what to
   install). The host starts the worker itself at the first call.
3. Click Call. Allow the microphone. Speak. With several microphones (a laptop and a headset) the panel lets you switch to the right one during the call. If the worker could not start, the panel says why (for instance a missing worker environment) instead of staying silent.

A face (a `video` call) needs the LiveAvatar provider chosen, with its key and avatar id (Providers › Face); without them, or with "No face", the call stays voice only. A member's own voice
needs nothing: it is the one chosen on its card. A voice made from a recording needs an ElevenLabs key and the switch on its provider page.

## How a call works

1. `POST /kybernos-call/token` returns a LiveKit room-join token (an HS256 JWT forged with `node:crypto`), starts the worker if it is not
   running, waits for it to register, and wakes it on the new room by explicit dispatch (`agent_name = kybernos-appel`).
   The worker takes the job whatever the machine's load (`load_fnc` returns 0, two warm processes): LiveKit's production default stops
   offering jobs above 70 % CPU, which on a busy laptop meant a call that never connected (measured 2026-10-08).
   **Who the call is with travels with the room**: the dispatch metadata carries `{ sessionId, kyberId, roleId, name, mode, language,
   voice, brain, limits }`, each field checked by the host (`callMetadata`). The worker serves many rooms, so none of it lives in its
   environment. What a surface does not say (mode, language, the assistant's voice) is filled from the settings.
2. The browser loads the LiveKit SDK (`/kybernos-call/vendor/livekit-client.js`, 2.22.3, Apache-2.0, at the first call only), joins the
   room, publishes the microphone and attaches the tracks it receives. The panel says "waiting for the assistant…" until the worker is in the room; if nobody has come after 15 s it says so and
   points to `kybernos/logs/appel-agent.log` (a worker that never got the job is otherwise silent).
3. The worker (`agent/agent.py`) reads the metadata (`agent/call_meta.py`), listens (Groq Whisper, in the call's language, or detecting
   it when it is `auto`), shows a face only on a `video` call, and POSTs every sentence it heard to `/kybernos-call/utterance`, which sends
   it to THAT call's session (`session/prompt`). If a turn of the session is already running, the words go in as `steer` (they correct
   it); otherwise they queue.
4. **One brain.** With a session behind the call (`brain: session`) the worker's small model does NOT answer (`StopResponse`). The host
   listens to the engine's `session/event` stream (`speech-feed.mjs`) and keeps, for the call's room, what the session's assistant writes;
   the worker long-polls `GET /kybernos-call/speech` and speaks it. Only the LEAD is spoken (`speakable()`): the first paragraph of each message
   (a lead-in ending with a colon takes its list), without code, tables, links, markup, emoji or arrows, cut at a sentence end under 450
   characters; the rest stays in the thread. While a call is live the host adds a short brief to that session's system prompt
   (`call-brief.mjs`, a `systemPrompt.context` chunk that is empty outside a call): answer in one to three spoken sentences, no menu of
   options, kybers or skills, no closing question, detail after a blank line. Measured on the first call: the answer was "Paris" and a
   voice then read the menu the assistant adds under every answer. If the session is still working after 10 s the voice says one short
   "one moment" in the call's language (it was 3.5 s and came at every turn). Without a session, or on an engine with no event stream,
   the small model answers, so a call is never silent.
   **What the panel shows and plays once connected.** A status line with a dot (amber while connecting, then green "listening", blue
   "thinking" while the session works on what was said, green with a ring while the assistant speaks), a bar that follows your microphone
   (the first thing to look at when nothing answers), and four bars that move with the assistant. Three soft tones, made in the page (no
   audio file): two rising notes when the assistant joins, one blip when the session starts working on what you said, two falling notes at
   hang-up (and a low one on an error). The "Sounds" button turns them off; the choice is kept per browser (`localStorage`). The "thinking"
   state comes from the worker: it sets the participant attribute `kb.working` while the session works (`_working_flag` in `agent.py`).
5. **The app's voice.** The worker speaks through the app's own voice engine (`POST /kybernos/tts/speak` of `@local/kybernos`: the one
   behind the member card's Preview, with its engines, a voice per language, a fallback chain and a cache), with the voice picked on the
   member's card and the language of the reply (`agent/call_voice.py`, `agent/host_tts.py`). The member's voice is kept while it speaks
   the language of the reply (or is multilingual, like Edge's `…MultilingualNeural`); in another language the engine picks a voice of that
   language on the same engine. With the call on `auto` a reply is spoken in the language it is written in (`agent/lang_guess.py`: the writing system, then the most common words
   of fr, en, es, de, it, pt, nl, tr; no dependency); one too short to tell takes the language of the last reply, then of what the user said. The speech-to-text's own
   language field came back empty on the first real call, so it is only a fallback. A voice made for another language (an English voice picked in Settings, a
   French reply) is replaced by one of the reply's language: measured, the English voice made Whisper hear "Ui, je ti entesteen, we can now have fun"; the
   replacement made it hear the sentence exactly. Emoji and arrows are not read. macOS `say` stays behind.
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
| `settings` | GET, POST | GET: the settings, which secrets are set, the clones, the five slots, the provider catalogue with each provider's state and settings, the presets. POST (same origin): `{ patch }`, all or nothing |
| `keys` | POST | same origin only; `{ patch: { NAME: value } }` (`''` removes); all or nothing; the answer never repeats a value |
| `test` | POST | same origin only; `{ service: 'livekit' \| 'groq' \| 'elevenlabs' \| 'liveavatar' }`: one read-only call, on this click only |
| `clone` | POST | same origin only; `{ rootId, voiceId, name }` creates, `{ action: 'delete', voiceId }` deletes |
| `preset` | POST | same origin only; `{ id }` fills the slots at once (a preset that is not available is 400) |
| `avatars` | POST | same origin only; the faces the face provider offers (names and ids; the account's own first) |
| `health` | POST | same origin only; checks every slot and answers `{ checks: [{ id, status, code, detail?, ms }] }`; the voice is asked through this DSH's own engine, at the socket's address |
| `engine` | POST | same origin only; `{ action: 'status' \| 'install' }`: the one-click install of the call engine, read back from its own log |
| `vendor/livekit-client.js` | GET, HEAD | the SDK, served as is |

DSH serves plugin routes before its own sign-in, so every POST, and the GET that returns session text, refuse any request that does not
come from the page's own origin (checked against the socket's real port, never the `Host` header).

## What it stores, and where (all under `$DSH_HOME`, else `~/.dsh`)

- `kybernos/livekit.env` (chmod 600): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GROQ_API_KEY`, `LIVEAVATAR_API_KEY`,
  `LIVEAVATAR_AVATAR_ID`, `LIVEAVATAR_SANDBOX`, `ELEVENLABS_API_KEY`. Any other line (the worker's `KYBER_*` options, comments) is left
  untouched when the page changes a key.
- `kybernos/kybernos-call/settings.json` and `clones.json` (chmod 600): the settings (which provider fills a slot, each provider's own settings, the voice, the language, the limits, whether the setup assistant has been through); the clones (a recording id → a provider voice id; no key).
- `kybernos/logs/engine-install.log` and `.json`: the call engine's install, and how it is going.
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
  routes, the settings page, the header buttons, the member cards, the voice engine and the session events. A full call with real
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
- macOS first (`say`, `pgrep`, `kill`). The engines other than `say` need their Python module (`piper`, `edge_tts`, `supertonic`); the core runs each with
  the first Python that can import it (`packages/kybernos-plugin/tts-python.mjs`: the PATH's `python3`, then `/usr/bin/python3` and the Homebrew ones). Before
  that, DSH started with Homebrew's `python3` reported Piper as ready and then failed, and Edge and Supertonic as absent although they were installed.
- Voice quality is the engine's: `say` is robotic (flat intonation); Piper (local, ~1 s a sentence), Supertonic (local) and Edge (online, the text goes to
  Microsoft) are neural. Settings › Calls › Voice marks the online engines and has a Listen button to compare them.

## Tests

`node packages/kybernos-call/test-*.mjs`: `test-host` (the token, the dispatch, the settings a call uses), `test-store` (settings, secrets,
clones on disk), `test-admin` (the settings page's host side, the clone provider, against fake servers), `test-routes`, `test-speech-feed`,
`test_call_stt.py` (listening through the host), `test-providers` (the catalogue, what the settings keep of it, the presets, LiveAvatar, the health check), `test-engine` (the one-click install, with a fake shell),
`test-client` (the panel and its indicators and sounds, the header buttons, the setup assistant's gate, the clone flow, in a fake browser), `test-call-brief`, `test-dsh-home`, `test-agent-process` (a real child
process, Unix only), `test-agent-meta` (the worker's Python tests through `python3`: `call_meta`, `call_voice`, and the LiveKit-facing worker
which are skipped without the worker's venv; run `<venv>/bin/python agent/test_call_agent.py` to run them). None needs DSH, a browser or the
network. In `@local/kybernos`, `test-call-seam.mjs` checks the member card's side.

On a real DSH (a sandbox: `scripts/sandbox/setup.sh` then `start.sh`, then `source scripts/sandbox/env.sh`):
`scripts/check-call-live.mjs` (the panel), `check-call-ui-live.mjs` (the header buttons, where they sit, and Settings › Calls), `check-call-team-live.mjs`
(a team's member cards), `check-call-brain-live.mjs` (the session's events reach the call), `check-call-voice-live.mjs` (the worker asks the
app's real voice engine), `check-call-engine-live.mjs` (the one-click install, for real: start the sandbox with `UV_CACHE_DIR` and `UV_PYTHON_INSTALL_DIR` pointing at the real ones to keep it to seconds). A real call needs a microphone: run it on the sandbox, never on your own GUI while it holds a conversation.
