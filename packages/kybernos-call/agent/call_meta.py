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
from dataclasses import dataclass
from typing import Mapping

# The languages the instruction names in English; any other code is passed through as is.
LANGUAGE_NAMES = {
    "fr": "French", "en": "English", "es": "Spanish", "de": "German", "it": "Italian",
    "pt": "Portuguese", "nl": "Dutch", "ar": "Arabic", "zh": "Chinese", "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "tr": "Turkish", "pl": "Polish", "hi": "Hindi",
}

_LANG_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


@dataclass(frozen=True)
class CallMeta:
    session_id: str = ""   # the session the words are sent to ("" = nowhere: a voice-only chat)
    kyber_id: str = ""     # the team
    role_id: str = ""      # the member
    name: str = ""         # the member's name, to speak as
    mode: str = "voice"    # "voice" (no face) or "video" (a face when a provider is set)
    language: str = "auto" # "auto" (follow the speaker) or a language code


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
