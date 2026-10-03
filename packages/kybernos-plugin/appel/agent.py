"""Kybernos — l'agent d'appel : un worker LiveKit lancé par l'hôte du plugin.

Ce que ce fichier est : la chaîne de §13 du chantier voix (STT → LLM → TTS →
visage), **chez nous**, avec les secrets du poste (`~/.dsh/kybernos/livekit.env`,
jamais dans le dépôt) et une prise vers la session DSH : chaque parole entendue
est renvoyée à l'hôte (`POST /kybernos/call/utterance`), qui la fait entrer dans
la session comme un **vrai tour** — c'est le « l'appel EST la discussion » (§13.6).

Il ne se lance pas à la main : l'hôte le démarre (`POST /kybernos/call/agent`),
le journalise dans `~/.dsh/kybernos/logs/appel-agent.log`, et lui donne la salle
par **dispatch explicite** (`agent_name = kybernos-appel`) — l'agent ne rejoint
donc jamais une salle par accident.

Interpréteur : le venv dédié `~/.dsh/kybernos/appel-venv` (`uv venv` + `uv pip
install -r requirements.txt`). Le python système ne suffit pas.

Pourquoi un LLM ici alors que DSH réfléchit : en v1 l'agent est la **voix** —
il répond tout de suite pour que l'appel soit vivant — pendant que le même texte
ouvre un tour DSH qui, lui, a les outils. La réponse DSH parlée viendra en v2
(elle demande de relire le fil de la session à chaud).
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
    """Les secrets de l'appel : `$DSH_HOME/kybernos/livekit.env` (chmod 600).

    L'environnement réel gagne : on ne pose que ce qui manque. Le second chemin
    ne sert qu'à un essai hors poste — jamais dans le dépôt.
    """
    dsh_home = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh")))
    for chemin in (dsh_home / "kybernos" / "livekit.env", Path(__file__).with_name(".env")):
        if not chemin.is_file():
            continue
        for ligne in chemin.read_text(encoding="utf-8").splitlines():
            ligne = ligne.strip()
            if not ligne or ligne.startswith("#") or "=" not in ligne:
                continue
            cle, valeur = ligne.split("=", 1)
            os.environ.setdefault(cle.strip(), valeur.strip().strip('"').strip("'"))
        return chemin
    return None


SOURCE_ENV = _load_env()
HOST = os.getenv("KYBER_HOST", "http://127.0.0.1:" + os.getenv("DSH_WEB_PORT", "3080"))
LOG_DIR = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh"))) / "kybernos" / "logs"
REPORT = LOG_DIR / "appel-agent.json"


def _dire(*parts: object) -> None:
    print(time.strftime("[%H:%M:%S]"), *parts, flush=True)


def _inject(texte: str) -> None:
    """La parole entendue devient un tour DSH. Jamais bloquant pour l'appel."""
    session_id = os.getenv("KYBER_SESSION_ID", "").strip()
    if not session_id or os.getenv("KYBER_INJECT", "1") != "1":
        return
    corps = json.dumps({
        "sessionId": session_id,
        "text": texte,
        "kyberId": os.getenv("KYBER_ID", ""),
        "origin": "appel",
    }).encode("utf-8")
    req = urllib.request.Request(
        HOST + "/kybernos/call/utterance",
        data=corps,
        method="POST",
        # L'hôte exige la même origine (anti-CSRF) : un worker local la déclare.
        headers={"content-type": "application/json", "origin": HOST},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as rep:
            charge = json.loads(rep.read().decode("utf-8"))
        _dire("tour DSH :", charge.get("ok"), charge.get("accepted"), charge.get("error", ""))
    except urllib.error.HTTPError as exc:
        _dire("tour DSH refusé :", exc.code, exc.read()[:160])
    except Exception as exc:  # l'appel continue même si la session est muette
        _dire("tour DSH injoignable :", exc)


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
    _dire("appel : salle", ctx.room.name, "| secrets", SOURCE_ENV, "| session", os.getenv("KYBER_SESSION_ID", "—"))
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=groq.STT(model=os.getenv("KYBER_STT", "whisper-large-v3-turbo"), language="fr"),
        llm=groq.LLM(model=os.getenv("KYBER_LLM", "openai/gpt-oss-20b")),
        tts=_build_tts(),
        # Pas de turn detector cloud / interruption adaptative : 401 sans clé
        # cloud et plusieurs secondes perdues avant le repli (mesuré au spike).
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
            _dire("rapport non écrit :", exc)

    @session.on("user_input_transcribed")
    def _on_user(ev) -> None:
        if not getattr(ev, "is_final", False):
            return
        marks.append({"t": round(time.time() - started, 3), "type": "user_transcript", "text": ev.transcript})
        _dire("entendu :", repr(ev.transcript))
        _dump()
        # Hors boucle d'événements : l'insertion ne doit jamais retarder la parole.
        asyncio.get_event_loop().run_in_executor(None, _inject, ev.transcript)

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        texte = getattr(ev.item, "text_content", None)
        if texte and getattr(ev.item, "role", "") == "assistant":
            marks.append({"t": round(time.time() - started, 3), "type": "assistant_text", "text": texte[:200]})
            _dire("réponse :", repr(texte[:200]))
            _dump()

    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:
        m = ev.metrics
        ligne = {"t": round(time.time() - started, 3), "type": type(m).__name__}
        for champ in ("ttfb", "duration", "ttft", "end_of_utterance_delay", "transcription_delay"):
            valeur = getattr(m, champ, None)
            if valeur is not None:
                ligne[champ] = round(valeur, 3) if isinstance(valeur, (int, float)) else valeur
        ligne["text"] = (getattr(m, "input_text", None) or getattr(m, "output_text", None) or "")[:120]
        marks.append(ligne)
        _dump()

    avatar = None
    # `KYBER_VISAGE=0` : voix seule. C'est ce que l'hôte demande quand le visage
    # est déjà pris, et ce que la preuve de la chaîne voix utilise.
    if os.getenv("LIVEAVATAR_API_KEY") and os.getenv("KYBER_VISAGE", "1") != "0":
        from livekit.plugins import liveavatar

        t0 = time.time()
        avatar = liveavatar.AvatarSession(
            avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
            video_quality=os.getenv("LIVEAVATAR_QUALITY", "medium"),
            # Bac à sable : gratuit, Wayne seul, ~60 s par session.
            is_sandbox=os.getenv("LIVEAVATAR_SANDBOX", "0") == "1",
        )
        await avatar.start(session, room=ctx.room)
        marks.append({"t": round(time.time() - started, 3), "type": "avatar_join", "duration": round(time.time() - t0, 3)})
        _dire("visage prêt en", round(time.time() - t0, 3), "s")

    # Sans visage, l'audio va dans la salle ; avec, il va au visage.
    await session.start(
        room=ctx.room,
        agent=Agent(instructions=INSTRUCTIONS),
        room_output_options=room_io.RoomOutputOptions(audio_enabled=avatar is None),
    )
    # Pas de salutation automatique : un tour propre d'abord (§13 du chantier).
    ctx.add_shutdown_callback(_dump)
    _dire("en ligne — visage", "oui" if avatar is not None else "non")


if __name__ == "__main__":
    # Un worker qui s'enregistre puis fait tomber chaque job est pire qu'un
    # worker qui refuse de démarrer : on le dit une fois, clairement (mesuré le
    # 24/09 — `GROQ_API_KEY` absente, job « crashed » à chaque dispatch).
    if not os.getenv("GROQ_API_KEY"):
        raise SystemExit(
            "GROQ_API_KEY absente : l'agent ne peut pas écouter. "
            "Posez-la dans ~/.dsh/kybernos/livekit.env (chmod 600)."
        )
    cli.run_app(server)
