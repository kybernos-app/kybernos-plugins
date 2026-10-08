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
import time
import urllib.error
import urllib.request
from pathlib import Path

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, room_io
from livekit.agents.voice.turn import InterruptionOptions, TurnHandlingOptions
from livekit.plugins import groq, silero

from local_tts import LocalSayTTS

AGENT_NAME = "kybernos-appel"

INSTRUCTIONS = os.getenv(
    "KYBER_INSTRUCTIONS",
    "Tu es le Kyber d'un poste de travail Kybernos, au téléphone. Réponds en "
    "français, une phrase courte, sans préambule, et ne propose rien d'autre.",
)


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


def _inject(text: str) -> None:
    """What is heard becomes a DSH turn. Never blocking for the call."""
    session_id = os.getenv("KYBER_SESSION_ID", "").strip()
    if not session_id or os.getenv("KYBER_INJECT", "1") != "1":
        return
    body = json.dumps({
        "sessionId": session_id,
        "text": text,
        "kyberId": os.getenv("KYBER_ID", ""),
        "origin": "appel",
    }).encode("utf-8")
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


def _build_tts():
    if os.getenv("KYBER_TTS", "say") == "groq":
        return groq.TTS(
            model=os.getenv("KYBER_GROQ_TTS", "playai-tts"),
            voice=os.getenv("KYBER_GROQ_VOICE", "Celeste-PlayAI"),
        )
    return LocalSayTTS(voice=os.getenv("KYBER_SAY_VOICE", "Thomas"))


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def kybernos_appel(ctx: JobContext) -> None:
    _say("call: room", ctx.room.name, "| secrets", SOURCE_ENV, "| session", os.getenv("KYBER_SESSION_ID", "-"))
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=groq.STT(model=os.getenv("KYBER_STT", "whisper-large-v3-turbo"), language="fr"),
        llm=groq.LLM(model=os.getenv("KYBER_LLM", "openai/gpt-oss-20b")),
        tts=_build_tts(),
        # No cloud turn detector / adaptive interruption: a 401 without a cloud key and several
        # seconds lost before the fallback (measured in the spike).
        turn_handling=TurnHandlingOptions(
            turn_detection="vad",
            interruption=InterruptionOptions(mode="vad"),
        ),
    )

    marks: list[dict] = []
    started = time.time()

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
        _say("heard:", repr(ev.transcript))
        _dump()
        # Off the event loop: the insertion must never delay the speech.
        asyncio.get_event_loop().run_in_executor(None, _inject, ev.transcript)

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
    # `KYBER_VISAGE=0`: voice only. It is what the host asks when the face is already taken, and
    # what the proof of the voice chain uses.
    if os.getenv("LIVEAVATAR_API_KEY") and os.getenv("KYBER_VISAGE", "1") != "0":
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
        agent=Agent(instructions=INSTRUCTIONS),
        room_output_options=room_io.RoomOutputOptions(audio_enabled=avatar is None),
    )
    # No automatic greeting: a clean turn first.
    ctx.add_shutdown_callback(_dump)
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
