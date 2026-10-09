"""Kybernos call agent: a LiveKit worker started by the host of @local/kybernos-call.

What this file is: the voice chain (STT -> LLM -> TTS -> face), on this machine, with the
machine's secrets (`<DSH_HOME>/kybernos/livekit.env`, never in the repository) and a hook into the
DSH session: every sentence heard is sent back to the host (`POST /kybernos-call/utterance`), which
makes it enter the session as a REAL turn: "the call IS the discussion".

It is not launched by hand: the host starts it (`POST /kybernos-call/agent`), logs it to
`<DSH_HOME>/kybernos/logs/appel-agent.log`, and gives it its room by EXPLICIT dispatch
(`agent_name = kybernos-appel`), so the agent never joins a room by accident.

Interpreter: the dedicated venv `<DSH_HOME>/kybernos/appel-venv` (`uv venv` + `uv pip install -r
requirements.txt`). The system python is not enough.

Why an LLM here while DSH thinks: in v1 the agent is the VOICE. It answers at once so the call
feels alive, while the same text opens a DSH turn that has the tools. Speaking DSH's own answer
comes next (it needs the session's thread read hot).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, StopResponse, cli, room_io, tts
from livekit.agents.voice.turn import InterruptionOptions, TurnHandlingOptions
from livekit.plugins import groq, silero

from call_meta import (CallMeta, CallState, fetch_speech, filler, instructions as build_instructions, parse_job_metadata,
                       speakable, stt_options, utterance_payload)
from call_voice import two_letters
from clone_tts import CloneTTS
from call_stt import language_hint
from host_stt import HostSTT
from host_tts import HostTTS
from local_tts import LocalSayTTS

AGENT_NAME = "kybernos-appel"

# A fixed brief for every call, for a hand-started worker (debug). Normally the brief is built per
# call from who is called and the language (call_meta.instructions).
INSTRUCTIONS_OVERRIDE = os.getenv("KYBER_INSTRUCTIONS")


def _load_env() -> Path | None:
    """The call's secrets: `$DSH_HOME/kybernos/livekit.env` (chmod 600).

    The real environment wins: only what is missing is set. The second path only serves a trial
    away from the machine, never in the repository.
    """
    dsh_home = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh")))
    for path in (dsh_home / "kybernos" / "livekit.env", Path(__file__).with_name(".env")):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        return path
    return None


SOURCE_ENV = _load_env()
HOST = os.getenv("KYBER_HOST", "http://127.0.0.1:" + os.getenv("DSH_WEB_PORT", "3080"))
LOG_DIR = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh"))) / "kybernos" / "logs"
REPORT = LOG_DIR / "appel-agent.json"


def _say(*parts: object) -> None:
    print(time.strftime("[%H:%M:%S]"), *parts, flush=True)


def _inject(meta: CallMeta, text: str, mode: str = "queue") -> None:
    """What is heard becomes a DSH turn of THIS call's session. Never blocking for the call.

    `mode` is "steer" when a turn of that session is running (the words correct it) and "queue" otherwise.
    """
    payload = utterance_payload(meta, text)
    if payload is None or os.getenv("KYBER_INJECT", "1") != "1":
        return
    body = json.dumps({**payload, "mode": mode, "origin": "appel"}).encode("utf-8")
    req = urllib.request.Request(
        HOST + "/kybernos-call/utterance",
        data=body,
        method="POST",
        # The host requires the same origin (anti-CSRF): a local worker declares it.
        headers={"content-type": "application/json", "origin": HOST},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as reply:
            payload = json.loads(reply.read().decode("utf-8"))
        _say("DSH turn:", payload.get("ok"), payload.get("accepted"), payload.get("error", ""))
    except urllib.error.HTTPError as exc:
        _say("DSH turn refused:", exc.code, exc.read()[:160])
    except Exception as exc:  # the call goes on even if the session is mute
        _say("DSH turn unreachable:", exc)


def _legacy_tts(kind: str):
    """The worker's own voices, from before the app's voice engine: macOS `say`, or Groq's (en/ar only)."""
    if kind == "groq":
        return groq.TTS(
            model=os.getenv("KYBER_GROQ_TTS", "playai-tts"),
            voice=os.getenv("KYBER_GROQ_VOICE", "Celeste-PlayAI"),
        )
    return LocalSayTTS(voice=os.getenv("KYBER_SAY_VOICE", "Thomas"))


def _build_stt(meta: CallMeta):
    """Who listens: Groq (the worker's own key), or the host on behalf of a model of the user's provider / the app's dictation."""
    if meta.stt_provider in ("models", "app"):
        return HostSTT(HOST, meta.stt_provider, meta.stt_model, language_hint(meta))
    return groq.STT(model=meta.stt_model or os.getenv("KYBER_STT", "whisper-large-v3-turbo"), **stt_options(meta))


def _build_tts(meta: CallMeta):
    """The call's voice: (the TTS handed to the session, the app-engine voice to tell the language to).

    By default the app's own voice engine (the member's voice, the reply's language), with macOS `say`
    behind it when that engine fails. A member whose recording was cloned at the provider speaks with the
    clone first (any language), then falls back to the app's engine. `KYBER_TTS` still decides for a
    worker that sets it:
      (unset), `say`, `app`   the app's voice engine. `say` was the old default, so a livekit.env that
                              says it keeps working and now speaks the member's voice
      `groq`                  Groq's voice (English and Arabic only)
      `legacy`                only the local macOS `say` voice, as before
    """
    forced = os.getenv("KYBER_TTS", "")
    if forced == "groq":
        return _legacy_tts("groq"), None
    if forced == "legacy":
        return _legacy_tts("say"), None
    voices = []
    key = os.getenv("ELEVENLABS_API_KEY", "")
    if meta.voice is not None and meta.voice.remote_id and key:
        voices.append(CloneTTS(key, meta.voice.remote_id, model=meta.clone_model))
    engine = HostTTS(HOST, meta)
    voices.append(engine)
    if sys.platform == "darwin":
        voices.append(_legacy_tts("say"))
    return (voices[0] if len(voices) == 1 else tts.FallbackAdapter(voices)), engine


class CallAgent(Agent):
    """The voice of a call. With a session behind the call, it does NOT answer by itself.

    The words heard go to the session (a real turn: its model, its tools, its permissions) and what
    the session's assistant writes is what is spoken (`_speak_session` below): one brain. Without a
    session, the small voice model answers, so a call is never silent.
    """

    def __init__(self, *, instructions: str, session_brain: bool) -> None:
        super().__init__(instructions=instructions)
        self._session_brain = session_brain

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        if self._session_brain:
            raise StopResponse()


def _working_flag(room):
    """`working(True/False)`: tells the page, through a participant attribute, that the session is working on
    what was just said (the browser shows it and plays a soft "heard you"). It only writes when the value changes."""
    last = {"on": None}

    def working(on: bool) -> None:
        if last["on"] is on:
            return
        last["on"] = on
        try:
            asyncio.get_running_loop().create_task(room.local_participant.set_attributes({"kb.working": "1" if on else "0"}))
        except Exception as exc:  # the call is closing
            _say("could not mark the state:", exc)

    return working


async def _speak_session(session: AgentSession, room: str, state: CallState | None = None, working=None) -> None:
    """Says what the session's assistant writes, as the host hands it over (a long poll)."""
    working = working if working is not None else (lambda on: None)
    loop = asyncio.get_running_loop()
    after = 0
    failures = 0
    while True:
        try:
            reply = await loop.run_in_executor(None, fetch_speech, HOST, room, after, 20000)
            failures = 0
        except Exception as exc:  # the host restarts, the network blinks: try again, then give up
            failures += 1
            _say("speech poll failed:", exc)
            if failures >= 5:
                _say("giving up on the session's replies")
                working(False)
                return
            await asyncio.sleep(min(2 * failures, 10))
            continue
        if reply.get("known") is False:
            _say("the host no longer follows this call")
            working(False)
            return
        for item in reply.get("items", []):
            if item.get("kind") == "end":
                working(False)
                if state is not None:
                    state.turn_ended()
            if item.get("kind") != "text":
                continue
            said = speakable(item.get("text", ""))
            if said:
                working(False)
                if state is not None:
                    state.reply_spoken()
                _say("speaking the session's reply:", repr(said[:120]))
                try:
                    session.say(said, allow_interruptions=True)
                except Exception as exc:  # the call is closing
                    _say("could not speak:", exc)
                    return
        after = max(after, int(reply.get("next", after) or after))


async def _say_while_waiting(session: AgentSession, state: CallState, language_now) -> None:
    """One short "one moment" when the session is still working and nothing has been said for a few seconds."""
    while True:
        await asyncio.sleep(0.5)
        if state.wants_filler():
            state.filler_said()
            try:
                session.say(filler(language_now() or "en"), allow_interruptions=True, add_to_chat_ctx=False)
            except Exception as exc:  # the call is closing
                _say("could not speak:", exc)
                return


async def _watch_limits(ctx: JobContext, state: CallState, meta: CallMeta) -> None:
    """Ends the call by itself after too long without the user speaking, or at the maximum length."""
    while True:
        await asyncio.sleep(10)
        reason = state.expired(meta.limits)
        if reason:
            _say("hanging up:", "no one spoke for a while" if reason == "silence" else "the call reached its maximum length")
            try:
                await ctx.delete_room()  # the browser sees the call end
            except Exception as exc:
                _say("could not delete the room:", exc)
                ctx.shutdown(reason=reason)
            return


# A personal worker: one person, one call at a time, on a machine that also runs a browser and builds. LiveKit's
# production defaults (stop taking jobs above 70 % CPU, keep 10 warm processes) made a call silently never connect on a
# busy laptop: measured 2026-10-08, load 0.9995 right at start, "marking as unavailable", no job ever received.
server = AgentServer(load_fnc=lambda: 0.0, num_idle_processes=2)


@server.rtc_session(agent_name=AGENT_NAME)
async def kybernos_appel(ctx: JobContext) -> None:
    # Who this call is with comes from the job that woke us (this worker serves many rooms).
    meta = parse_job_metadata(getattr(ctx.job, "metadata", ""), os.environ)
    _say("call: room", ctx.room.name, "| secrets", SOURCE_ENV, "| session", meta.session_id or "-",
         "| as", meta.name or "-", "| mode", meta.mode, "| language", meta.language, "| brain", meta.brain,
         "| voice", (meta.voice.engine + "::" + meta.voice.voice) if meta.voice and meta.voice.engine else "default")
    voice, app_voice = _build_tts(meta)
    state = CallState(time.monotonic)
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=_build_stt(meta),
        llm=groq.LLM(model=os.getenv("KYBER_LLM", "openai/gpt-oss-20b")),
        tts=voice,
        # No cloud turn detector / adaptive interruption: a 401 without a cloud key and several
        # seconds lost before the fallback (measured in the spike).
        turn_handling=TurnHandlingOptions(
            turn_detection="vad",
            interruption=InterruptionOptions(mode="vad"),
        ),
    )

    marks: list[dict] = []
    started = time.time()
    working = _working_flag(ctx.room)

    def _dump() -> None:
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            REPORT.write_text(json.dumps({"marks": marks}, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            _say("report not written:", exc)

    @session.on("user_input_transcribed")
    def _on_user(ev) -> None:
        if not getattr(ev, "is_final", False):
            return
        marks.append({"t": round(time.time() - started, 3), "type": "user_transcript", "text": ev.transcript})
        _say("heard:", repr(ev.transcript), getattr(ev, "language", None) or "")
        if app_voice is not None:
            app_voice.hear(getattr(ev, "language", None), ev.transcript)
        state.user_spoke()
        _dump()
        # If a turn of the session is running, these words correct it (steer); otherwise they start the next one.
        mode = state.inject_mode() if meta.brain == "session" else "queue"
        if meta.brain == "session" and meta.session_id:
            state.turn_started()
            working(True)
        # Off the event loop: the insertion must never delay the speech.
        asyncio.get_event_loop().run_in_executor(None, _inject, meta, ev.transcript, mode)

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        text = getattr(ev.item, "text_content", None)
        if text and getattr(ev.item, "role", "") == "assistant":
            marks.append({"t": round(time.time() - started, 3), "type": "assistant_text", "text": text[:200]})
            _say("answer:", repr(text[:200]))
            _dump()

    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:
        m = ev.metrics
        entry = {"t": round(time.time() - started, 3), "type": type(m).__name__}
        for field in ("ttfb", "duration", "ttft", "end_of_utterance_delay", "transcription_delay"):
            value = getattr(m, field, None)
            if value is not None:
                entry[field] = round(value, 3) if isinstance(value, (int, float)) else value
        entry["text"] = (getattr(m, "input_text", None) or getattr(m, "output_text", None) or "")[:120]
        marks.append(entry)
        _dump()

    avatar = None
    # A face only on a video call, and only when a provider is set: a voice call costs no face minutes.
    if os.getenv("LIVEAVATAR_API_KEY") and meta.mode == "video":
        from livekit.plugins import liveavatar

        t0 = time.time()
        avatar = liveavatar.AvatarSession(
            avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
            video_quality=os.getenv("LIVEAVATAR_QUALITY", "medium"),
            # Sandbox: free, the Wayne avatar only, ~60 s per session.
            is_sandbox=os.getenv("LIVEAVATAR_SANDBOX", "0") == "1",
        )
        await avatar.start(session, room=ctx.room)
        marks.append({"t": round(time.time() - started, 3), "type": "avatar_join", "duration": round(time.time() - t0, 3)})
        _say("face ready in", round(time.time() - t0, 3), "s")

    # Without a face, the audio goes into the room; with one, it goes to the face.
    await session.start(
        room=ctx.room,
        agent=CallAgent(instructions=build_instructions(meta, INSTRUCTIONS_OVERRIDE), session_brain=meta.brain == "session"),
        room_output_options=room_io.RoomOutputOptions(audio_enabled=avatar is None),
    )
    # No automatic greeting: a clean turn first.
    async def _dump_at_end() -> None:  # LiveKit awaits shutdown callbacks: a plain function made every job end with a TypeError
        _dump()

    ctx.add_shutdown_callback(_dump_at_end)
    tasks = [asyncio.create_task(_watch_limits(ctx, state, meta))]
    if meta.brain == "session":
        tasks.append(asyncio.create_task(_speak_session(session, ctx.room.name, state, working)))
        language_now = (app_voice.current_language if app_voice is not None else (lambda: two_letters(meta.language)))
        tasks.append(asyncio.create_task(_say_while_waiting(session, state, language_now)))

    async def _stop_tasks() -> None:
        for task in tasks:
            task.cancel()

    ctx.add_shutdown_callback(_stop_tasks)
    _say("online - face", "yes" if avatar is not None else "no")


if __name__ == "__main__":
    # A worker that registers and then crashes every job is worse than one that refuses to start:
    # say it once, clearly (measured on 24/09: `GROQ_API_KEY` missing, job "crashed" at every dispatch).
    if not os.getenv("GROQ_API_KEY"):
        raise SystemExit(
            "GROQ_API_KEY missing: the agent cannot listen. "
            "Put it in <DSH_HOME>/kybernos/livekit.env (chmod 600)."
        )
    cli.run_app(server)
