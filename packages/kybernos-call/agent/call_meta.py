"""Who a call is with, read from the job that woke the worker.

The worker is long-lived and serves one room after another, so what is specific to a call (the
session its words go to, the team member it speaks as, voice or face, the language) cannot live in
the process environment: it would stay the one of the FIRST call. The host sends it as the dispatch
metadata of each room (a JSON string); this module reads it.

Pure Python (standard library only) so it can be tested without LiveKit.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Mapping

# The languages the instruction names in English; any other code is passed through as is.
LANGUAGE_NAMES = {
    "fr": "French", "en": "English", "es": "Spanish", "de": "German", "it": "Italian",
    "pt": "Portuguese", "nl": "Dutch", "ar": "Arabic", "zh": "Chinese", "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "tr": "Turkish", "pl": "Polish", "hi": "Hindi",
}

_LANG_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


@dataclass(frozen=True)
class VoiceChoice:
    """The voice picked for the member on the app's own voice engine (the card's voice list).

    `custom` is a recording the member was given: no engine speaks it yet, so the default voice is used.
    """
    engine: str = ""
    voice: str = ""
    lang: str = ""
    custom: bool = False


_ENGINE_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
_VOICE_RE = re.compile(r"^[A-Za-z0-9._:() -]{1,100}$")


def _voice(raw: object) -> VoiceChoice | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("custom") is True:
        return VoiceChoice(custom=True)
    engine, voice, lang = raw.get("engine"), raw.get("voice"), raw.get("lang")
    if not (isinstance(engine, str) and _ENGINE_RE.match(engine)):
        return None
    if not (isinstance(voice, str) and _VOICE_RE.match(voice)):
        return None
    return VoiceChoice(engine, voice, lang[:2].lower() if isinstance(lang, str) and re.match(r"^[A-Za-z]{2}", lang) else "")


@dataclass(frozen=True)
class CallMeta:
    session_id: str = ""   # the session the words are sent to ("" = nowhere: a voice-only chat)
    kyber_id: str = ""     # the team
    role_id: str = ""      # the member
    name: str = ""         # the member's name, to speak as
    mode: str = "voice"    # "voice" (no face) or "video" (a face when a provider is set)
    language: str = "auto" # "auto" (follow the speaker) or a language code
    brain: str = "voice"   # "session": speak what the session's assistant writes; "voice": the small model answers
    voice: VoiceChoice | None = None  # the member's voice on the app's voice engine; None = the default voice


def _text(value: object, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse_job_metadata(raw: str | None, env: Mapping[str, str] | None = None) -> CallMeta:
    """The call's identity: the job's metadata first, the environment as a fallback.

    The fallback keeps a hand-started worker working (the spike, a debug run): there the
    environment is the only source. A bad or empty metadata never raises.
    """
    env = env or {}
    data: dict = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                data = parsed
        except ValueError:
            data = {}

    language = _text(data.get("language"), 16) or _text(env.get("KYBER_LANGUAGE"), 16) or "fr"
    if language != "auto" and not _LANG_RE.match(language):
        language = "auto"

    # Without metadata, the old switch decides: KYBER_VISAGE=0 is voice only.
    mode = data.get("mode") if data.get("mode") in ("voice", "video") else (
        "voice" if env.get("KYBER_VISAGE", "1") == "0" else "video")

    return CallMeta(
        session_id=_text(data.get("sessionId"), 120) or _text(env.get("KYBER_SESSION_ID"), 120),
        kyber_id=_text(data.get("kyberId"), 64) or _text(env.get("KYBER_ID"), 64),
        role_id=_text(data.get("roleId"), 64),
        name=_text(data.get("name"), 60),
        mode=mode,
        language=language,
        brain="session" if data.get("brain") == "session" and _text(data.get("sessionId"), 120) else "voice",
        voice=_voice(data.get("voice")),
    )


def stt_options(meta: CallMeta) -> dict:
    """What to hand to the speech-to-text: a named language, or detection when it is "auto"."""
    if meta.language == "auto":
        return {"language": "en", "detect_language": True}  # the language is only a hint when detecting
    return {"language": meta.language.split("-")[0], "detect_language": False}


def instructions(meta: CallMeta, override: str | None = None) -> str:
    """The voice model's brief for this call. `override` (KYBER_INSTRUCTIONS) wins when set."""
    if override:
        return override
    who = meta.name or "the Kyber"
    if meta.language == "auto":
        speak = "the language the user speaks"
    else:
        speak = LANGUAGE_NAMES.get(meta.language.split("-")[0], meta.language)
    return (
        f"You are {who}, a member of the user's Kybernos team, on a phone call. "
        f"Answer in {speak}, in one short sentence, with no preamble, and offer nothing else."
    )


def utterance_payload(meta: CallMeta, text: str) -> dict | None:
    """The body of POST /kybernos-call/utterance, or None when the call has no session to write to."""
    if not meta.session_id:
        return None
    return {"sessionId": meta.session_id, "text": text, "kyberId": meta.kyber_id, "roleId": meta.role_id}


# ── One brain: speaking what the session's assistant wrote ──────────────────────────────────────

_FENCE = re.compile(r"```.*?```", re.DOTALL)
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_URL = re.compile(r"https?://\S+")
_SENTENCE_END = re.compile(r"[.!?\u2026](?=\s|$)")


def speakable(text: str, limit: int = 700) -> str:
    """The part of an assistant message worth saying aloud, or "" when there is none.

    A written answer is full of things a voice cannot say: code, tables, links, markup. They stay in
    the thread, where the user can read them. What is left is cut at a sentence end under `limit`.
    """
    if not isinstance(text, str):
        return ""
    text = _FENCE.sub(" ", text)
    text = _LINK.sub(r"\1", text)
    text = _URL.sub("", text)
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.count("|") >= 2 or re.fullmatch(r"[-=*_ ]{3,}", line):
            continue  # a blank line, a table row, a rule
        line = re.sub(r"^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)", "", line)
        line = re.sub(r"[*_`~]+", "", line).strip()
        if line:
            lines.append(line if re.search(r"[.!?\u2026:]$", line) else line + ".")
    out = " ".join(lines)
    out = re.sub(r"\s+", " ", out).strip()
    if len(out) <= limit:
        return out
    cut = out[:limit]
    ends = [m.end() for m in _SENTENCE_END.finditer(cut)]
    if ends:
        return cut[: ends[-1]].strip()
    return cut[: cut.rfind(" ")].strip() + "." if " " in cut else cut


def speech_url(host: str, room: str, after: int, wait_ms: int) -> str:
    query = urllib.parse.urlencode({"room": room, "after": int(after), "wait": int(wait_ms)})
    return host.rstrip("/") + "/kybernos-call/speech?" + query


def fetch_speech(host: str, room: str, after: int = 0, wait_ms: int = 0,
                 opener: Callable = urllib.request.urlopen) -> dict:
    """Asks the host for what the session's assistant wrote since `after` (a long poll).

    The host only answers its own origin: a local worker declares it, like for `utterance`.
    Returns {"ok", "known", "items": [{"seq", "kind", ...}], "next"}; raises on a network error.
    """
    request = urllib.request.Request(speech_url(host, room, after, wait_ms), headers={"origin": host.rstrip("/")})
    with opener(request, timeout=wait_ms / 1000 + 10) as reply:
        data = json.loads(reply.read().decode("utf-8"))
    return data if isinstance(data, dict) else {"ok": False, "known": False, "items": [], "next": after}
