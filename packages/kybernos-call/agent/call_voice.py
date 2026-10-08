"""The voice of a call, on the app's own voice engine.

The app already has a voice engine (the core's `/kybernos/tts/speak`): several engines (macOS `say`,
Piper, Edge, Supertonic…), a voice per language, a fallback chain and a cache; it is what the member
card previews. A call speaks through it, so a member sounds the same in a call as in its preview, and
any language the engine has a voice for can be spoken.

This module is the part without LiveKit: which voice to ask for, the request, the decoding of what
comes back. `host_tts.py` plugs it into the worker. Standard library, plus PyAV for the decoding
(a dependency of livekit-agents, already in the worker's environment).
"""

from __future__ import annotations

import base64
import io
import json
import re
import urllib.error
import urllib.request
from typing import Callable

from call_meta import CallMeta, VoiceChoice

SAMPLE_RATE = 24_000
_DATA_URL = re.compile(r"^data:[^;,]+;base64,(.*)$", re.DOTALL)


def two_letters(code: object) -> str:
    """"fr-FR" / "FR" / "fra" → "fr"; anything that is not a language code → ""."""
    if isinstance(code, str):
        m = re.match(r"^([A-Za-z]{2})(?:[A-Za-z]?$|[-_])", code.strip())
        if m:
            return m.group(1).lower()
    return ""


def reply_language(meta: CallMeta, heard: str = "") -> str:
    """The language a reply is spoken in: the call's own when it names one, else the one just heard."""
    if meta.language != "auto":
        return two_letters(meta.language)
    return two_letters(heard)


def voice_request(meta: CallMeta, language: str) -> dict:
    """What to ask the voice engine for, as the fields of `tts/speak` ({} = the app's default voice).

    The member's voice is kept while it can speak the language of the reply. When the reply is in
    another language, the engine picks a voice of that language, so a French voice does not read
    Spanish with a French accent; a voice that says it is multilingual is kept for any language.
    """
    choice: VoiceChoice | None = meta.voice
    request: dict = {}
    if language:
        request["lang"] = language
    if choice is None or choice.custom or not choice.engine:
        return request
    request["engine"] = choice.engine
    same = (not language) or (not choice.lang) or choice.lang == language
    if same or "multilingual" in choice.voice.lower():
        request["voice"] = choice.voice
        if not language and choice.lang:
            request["lang"] = choice.lang
    return request


def speak_request(host: str, text: str, fields: dict, opener: Callable = urllib.request.urlopen,
                  timeout: float = 40.0) -> dict:
    """POST /kybernos/tts/speak. Returns the host's answer; raises when there is no audio."""
    body = json.dumps({"text": text, **fields}).encode("utf-8")
    request = urllib.request.Request(
        host.rstrip("/") + "/kybernos/tts/speak", data=body, method="POST",
        headers={"content-type": "application/json", "origin": host.rstrip("/")},
    )
    with opener(request, timeout=timeout) as reply:
        answer = json.loads(reply.read().decode("utf-8"))
    if not isinstance(answer, dict) or answer.get("ok") is not True or not isinstance(answer.get("audio"), str):
        error = answer.get("error") if isinstance(answer, dict) else None
        raise RuntimeError("the voice engine gave no audio" + (": " + str(error) if error else ""))
    return answer


def audio_bytes(answer: dict) -> bytes:
    m = _DATA_URL.match(answer.get("audio", ""))
    if not m:
        raise RuntimeError("the voice engine's audio is not a data URL")
    return base64.b64decode(m.group(1))


def decode_pcm(data: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Any audio PyAV reads (the engine renders m4a) → mono 16-bit PCM at `sample_rate`."""
    import av  # imported here: the rest of the module works without it

    out = bytearray()
    container = av.open(io.BytesIO(data))
    try:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)
        for frame in container.decode(audio=0):
            for piece in resampler.resample(frame):
                out += piece.to_ndarray().tobytes()
        for piece in resampler.resample(None):
            out += piece.to_ndarray().tobytes()
    finally:
        container.close()
    if not out:
        raise RuntimeError("the voice engine's audio is empty")
    return bytes(out)


def render_pcm(host: str, text: str, meta: CallMeta, language: str,
               opener: Callable = urllib.request.urlopen) -> bytes:
    """Text → PCM, through the app's voice engine, for this call's member and the reply's language."""
    answer = speak_request(host, text, voice_request(meta, language), opener)
    return decode_pcm(audio_bytes(answer))


# ── A cloned voice: spoken by the provider that holds the clone ─────────────────────────────────

ELEVEN_BASE = "https://api.elevenlabs.io"
ELEVEN_MODEL = "eleven_multilingual_v2"  # speaks any language with the cloned voice


def eleven_request(key: str, voice_id: str, text: str, model: str = ELEVEN_MODEL, base: str = ELEVEN_BASE,
                   opener: Callable = urllib.request.urlopen, timeout: float = 45.0) -> bytes:
    """Text → mp3, in the cloned voice, at the provider. Raises with a reason a person can act on."""
    if not re.fullmatch(r"[A-Za-z0-9]{6,64}", voice_id or ""):
        raise RuntimeError("the cloned voice id is not valid")
    request = urllib.request.Request(
        base.rstrip("/") + "/v1/text-to-speech/" + voice_id + "?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": model}).encode("utf-8"), method="POST",
        headers={"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"},
    )
    try:
        with opener(request, timeout=timeout) as reply:
            return reply.read()
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise RuntimeError("ElevenLabs refused the key") from exc
        if exc.code == 404:
            raise RuntimeError("the cloned voice no longer exists at ElevenLabs") from exc
        raise RuntimeError("ElevenLabs answered HTTP %d" % exc.code) from exc


def render_eleven_pcm(key: str, voice_id: str, text: str, base: str = ELEVEN_BASE,
                      opener: Callable = urllib.request.urlopen) -> bytes:
    return decode_pcm(eleven_request(key, voice_id, text, base=base, opener=opener))
