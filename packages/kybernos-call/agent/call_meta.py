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

    `custom` is a recording the member was given. When the host cloned it at a provider, `remote_provider`
    and `remote_id` name that clone and it is spoken with it; otherwise no engine speaks it and the default
    voice is used.
    """
    engine: str = ""
    voice: str = ""
    lang: str = ""
    custom: bool = False
    remote_provider: str = ""
    remote_id: str = ""


_ENGINE_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
_REMOTE_ID_RE = re.compile(r"^[A-Za-z0-9]{6,64}$")
_VOICE_RE = re.compile(r"^[\w.:() -]{1,100}$")  # \w: letters of any language (the app's own French voice is "Amélie")


def _voice(raw: object) -> VoiceChoice | None:
    if not isinstance(raw, dict):
        return None
    if raw.get("custom") is True:
        remote = raw.get("remote")
        if isinstance(remote, dict) and remote.get("provider") == "elevenlabs" and isinstance(remote.get("id"), str) \
                and _REMOTE_ID_RE.match(remote["id"]):
            return VoiceChoice(custom=True, remote_provider="elevenlabs", remote_id=remote["id"])
        return VoiceChoice(custom=True)
    engine, voice, lang = raw.get("engine"), raw.get("voice"), raw.get("lang")
    if not (isinstance(engine, str) and _ENGINE_RE.match(engine)):
        return None
    if not (isinstance(voice, str) and _VOICE_RE.match(voice)):
        return None
    return VoiceChoice(engine, voice, lang[:2].lower() if isinstance(lang, str) and re.match(r"^[A-Za-z]{2}", lang) else "")


@dataclass(frozen=True)
class CallLimits:
    """When a call hangs up by itself: after this long without the user speaking, or at this length."""
    silence_ms: int = 5 * 60_000
    max_ms: int = 60 * 60_000


def _limits(raw: object) -> CallLimits:
    if not isinstance(raw, dict):
        return CallLimits()

    def bounded(value: object, low: int, high: int, default: int) -> int:
        return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and low <= value <= high else default

    return CallLimits(
        silence_ms=bounded(raw.get("silenceMs"), 60_000, 3_600_000, CallLimits.silence_ms),
        max_ms=bounded(raw.get("maxMs"), 300_000, 14_400_000, CallLimits.max_ms),
    )


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
    limits: CallLimits = CallLimits()
    stt_provider: str = "groq"  # who listens: "groq" (the worker's own), "models" (a model of the user's provider) or "app" (the app's dictation)
    stt_model: str = ""    # the listening model chosen in the settings ("" = the worker's default; for "models": "<provider>:<model>")
    clone_model: str = ""  # the cloned-voice model chosen in the settings ("" = the default)


_MODEL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,160}$")


def _model(value: object) -> str:
    return value if isinstance(value, str) and _MODEL_RE.match(value) else ""


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
        limits=_limits(data.get("limits")),
        stt_provider=data.get("sttProvider") if data.get("sttProvider") in ("groq", "models", "app") else "groq",
        stt_model=_model(data.get("sttModel")),
        clone_model=_model(data.get("cloneModel")),
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
_ARROWS = re.compile(r"\s*[\u2190-\u21ff\u27f5-\u27ff]+\s*")
_PICTOGRAPHS = re.compile("[\U0001f000-\U0001faff\u2600-\u27bf\u2b00-\u2bff\ufe0f\u200d]")


_LIST_ITEM = re.compile(r"^\s*([-*+]|\d+[.)])\s+")


def _block_kind(block: str) -> str:
    """What a paragraph of a written answer is, for a voice: prose, a list, or something a voice skips."""
    lines = [ln for ln in block.splitlines() if ln.strip()]
    if not lines:
        return "skip"
    if all(re.fullmatch(r"\s*[-=*_ ]{3,}\s*", ln) for ln in lines):
        return "skip"  # a rule
    if sum(1 for ln in lines if ln.count("|") >= 2) * 2 >= len(lines):
        return "skip"  # a table
    if all(re.match(r"^\s*#{1,6}\s", ln) for ln in lines):
        return "skip"  # headings alone
    if all(_LIST_ITEM.match(ln) for ln in lines):
        return "list"
    return "prose"


def _spoken_words(block: str) -> str:
    lines = []
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.count("|") >= 2 or re.fullmatch(r"[-=*_ ]{3,}", line):
            continue
        line = re.sub(r"^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)", "", line)
        line = re.sub(r"[*_`~]+", "", line).strip()
        if line:
            lines.append(line if re.search(r"[.!?\u2026:]$", line) else line + ".")
    return " ".join(lines)


def speakable(text: str, limit: int = 450) -> str:
    """The part of an assistant message worth saying aloud, or "" when there is none.

    A written answer is full of things a voice cannot or should not say: code, tables, links, markup, and the
    menus of options an assistant likes to add under its answer. What is said is the LEAD: the first paragraph
    (a lead-in ending with a colon takes the list under it), cut at a sentence end under `limit`. The rest stays
    in the thread, where the user can read it.
    """
    if not isinstance(text, str):
        return ""
    text = _FENCE.sub(" ", text)
    text = _LINK.sub(r"\1", text)
    text = _URL.sub("", text)
    text = _ARROWS.sub(", ", text)
    text = _PICTOGRAPHS.sub("", text)  # a voice reads an emoji as its name, or not at all
    blocks = [(b, _block_kind(b)) for b in re.split(r"\n\s*\n", text)]
    blocks = [(b, k) for b, k in blocks if k != "skip"]
    if not blocks:
        return ""
    chosen = [blocks[0][0]]
    if blocks[0][1] == "prose" and len(blocks) > 1 and blocks[1][1] == "list" and blocks[0][0].rstrip().endswith(":"):
        chosen.append(blocks[1][0])
    out = re.sub(r"\s+", " ", " ".join(_spoken_words(b) for b in chosen)).strip()
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


# ── What a call says on its own, and when it stops ──────────────────────────────────────────────

# A short phrase while the session is still working, in the language of the call.
FILLERS = {
    "fr": "Un instant, je regarde.",
    "en": "One moment, I'm looking into it.",
    "es": "Un momento, lo estoy mirando.",
    "de": "Einen Moment, ich schaue nach.",
    "it": "Un attimo, controllo.",
    "pt": "Um momento, vou ver.",
    "nl": "Een moment, ik kijk ernaar.",
    "ar": "لحظة، أنظر في الأمر.",
    "zh": "请稍等，我来看看。",
    "ja": "少々お待ちください、確認します。",
    "ru": "Одну минуту, я посмотрю.",
}


def filler(language: str) -> str:
    return FILLERS.get((language or "").split("-")[0].lower(), FILLERS["en"])


class CallState:
    """What the worker knows about the turn that is running, with the clock injected (testable).

    A turn is running from the moment the words are sent to the session until its end comes back through
    the feed. While it runs: what the user says next is *steered* into it instead of queued behind it, and
    after a few seconds without a word the voice says one short "one moment". A turn whose end never
    comes cannot trap the call: it is forgotten after `STALE_S`.
    """

    FILLER_AFTER_S = 10.0  # an answer in a few seconds needs no "one moment" (it was said at every turn at 3.5 s)
    STALE_S = 120.0

    def __init__(self, now: Callable[[], float]) -> None:
        self._now = now
        self.started_at = now()
        self.last_user_at = now()
        self._turn_at: float | None = None
        self._spoke = False
        self._filler_said = False

    # turns
    def busy(self) -> bool:
        return self._turn_at is not None and self._now() - self._turn_at < self.STALE_S

    def inject_mode(self) -> str:
        return "steer" if self.busy() else "queue"

    def user_spoke(self) -> None:
        self.last_user_at = self._now()

    def turn_started(self) -> None:
        if not self.busy():
            self._turn_at = self._now()
            self._spoke = False
            self._filler_said = False

    def reply_spoken(self) -> None:
        self._spoke = True

    def turn_ended(self) -> None:
        self._turn_at = None
        self._spoke = False
        self._filler_said = False

    # the voice
    def wants_filler(self) -> bool:
        if not self.busy() or self._spoke or self._filler_said:
            return False
        return self._now() - self._turn_at >= self.FILLER_AFTER_S

    def filler_said(self) -> None:
        self._filler_said = True

    # the end of the call
    def expired(self, limits: CallLimits) -> str | None:
        now = self._now()
        if (now - self.started_at) * 1000 >= limits.max_ms:
            return "max"
        # A turn in progress is the session working for the user, not silence.
        if not self.busy() and (now - self.last_user_at) * 1000 >= limits.silence_ms:
            return "silence"
        return None
