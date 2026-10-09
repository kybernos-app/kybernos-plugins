"""A LiveKit STT that listens through the host (see call_stt.py): a model of the user's provider, or the app's dictation."""

from __future__ import annotations

import asyncio

from livekit import rtc
from livekit.agents import APIConnectOptions, LanguageCode, stt
from livekit.agents.types import NOT_GIVEN, NotGivenOr

from call_stt import listen_request

DEFAULT_CONN = APIConnectOptions(max_retry=1, retry_interval=1.0, timeout=45.0)


class HostSTT(stt.STT):
    """Not streaming: the voice activity detector cuts the speech into sentences, each one is sent whole."""

    def __init__(self, host: str, provider: str, model: str = "", language: str = "") -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._host = host
        self._provider = provider
        self._model_name = model
        self._language = language

    @property
    def model(self) -> str:
        return self._model_name or "app-dictation"

    @property
    def provider(self) -> str:
        return "kybernos-" + self._provider

    async def _recognize_impl(self, buffer, *, language: NotGivenOr[str] = NOT_GIVEN,
                              conn_options: APIConnectOptions = DEFAULT_CONN) -> stt.SpeechEvent:
        frame = rtc.combine_audio_frames(buffer)
        wav = frame.to_wav_bytes()
        hint = language if isinstance(language, str) and language else self._language
        words = await asyncio.to_thread(listen_request, self._host, self._provider, self._model_name, wav, hint)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(language=LanguageCode(hint or "en"), text=words)],
        )
