"""Listening through a model of the user's own provider, or through the app's dictation (see host_stt.py for the LiveKit side).

The worker never holds the provider's key: the host does. It sends the speech (a WAV) to the host, which asks the provider with the key
the app already has for it, and gets the words back. Standard library only.
"""

from __future__ import annotations

import base64
import json
import re
import urllib.request
from typing import Callable

from call_meta import CallMeta


def listen_request(host: str, provider: str, model: str, wav: bytes, language: str = "",
                   opener: Callable = urllib.request.urlopen, timeout: float = 40.0) -> str:
    """The words in `wav`, or "" when there are none. Raises when the host or the provider fails (a reason a person can read).

    provider "models": a listening model of a provider set up in Models, `model` being "<provider>:<model>".
    provider "app": the app's own dictation (the model its voice settings point to).
    """
    audio = base64.b64encode(wav).decode("ascii")
    if provider == "models":
        sep = model.find(":")
        if sep <= 0:
            raise RuntimeError("no listening model is chosen (Settings › Calls › Providers › Listen)")
        path, body = "/kybernos/models/audio/listen", {"provider": model[:sep], "model": model[sep + 1:], "audio": audio}
    elif provider == "app":
        path, body = "/kybernos/voice/transcribe", {"audio": "data:audio/wav;base64," + audio}
    else:
        raise RuntimeError("unknown listening provider: " + provider)
    if language:
        body["language"] = language
    request = urllib.request.Request(
        host.rstrip("/") + path, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"content-type": "application/json", "origin": host.rstrip("/")},
    )
    with opener(request, timeout=timeout) as reply:
        answer = json.loads(reply.read().decode("utf-8"))
    if not isinstance(answer, dict):
        raise RuntimeError("the host's answer is not readable")
    if answer.get("ok") is True and isinstance(answer.get("text"), str):
        return answer["text"].strip()
    error = answer.get("error")
    # Speech too short or silent is not a failure of the service: nothing was said.
    if isinstance(error, str) and re.search(r"\binaudible\b|too short|\btrop court\b|\bvide\b|empty audio", error):
        return ""
    raise RuntimeError(str(error) if error else "the listening service gave no text")


def language_hint(meta: CallMeta) -> str:
    """The call's language as the two letters providers expect, "" in auto (let the provider detect it)."""
    return "" if meta.language == "auto" else meta.language.split("-")[0].lower()
