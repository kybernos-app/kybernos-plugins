"""A LiveKit TTS that speaks through the app's own voice engine (see call_voice.py)."""

from __future__ import annotations

import asyncio

from livekit.agents import APIConnectOptions, tts, utils

from call_meta import CallMeta
from call_voice import SAMPLE_RATE, reply_language, render_pcm

DEFAULT_CONN = APIConnectOptions(max_retry=2, retry_interval=1.0, timeout=45.0)


class HostTTS(tts.TTS):
    def __init__(self, host: str, meta: CallMeta) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=SAMPLE_RATE,
            num_channels=1,
        )
        self._host = host
        self._meta = meta
        self._heard = ""  # the language of the last thing the user said, for a call in "auto"

    @property
    def model(self) -> str:
        return "kybernos-voice-engine"

    @property
    def provider(self) -> str:
        return "kybernos"

    def hear(self, language: object) -> None:
        """What language the user just spoke: the reply follows it (only used when the call is "auto")."""
        if isinstance(language, str) and language:
            self._heard = language

    def current_language(self) -> str:
        return reply_language(self._meta, self._heard)

    def synthesize(self, text: str, *, conn_options: APIConnectOptions = DEFAULT_CONN) -> tts.ChunkedStream:
        return _HostStream(tts=self, input_text=text, conn_options=conn_options)


class _HostStream(tts.ChunkedStream):
    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        engine: HostTTS = self._tts  # type: ignore[assignment]
        pcm = await asyncio.to_thread(render_pcm, engine._host, self._input_text, engine._meta, engine.current_language())
        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=SAMPLE_RATE,
            num_channels=1,
            mime_type="audio/pcm",
            frame_size_ms=100,
        )
        output_emitter.push(pcm)
        output_emitter.flush()
