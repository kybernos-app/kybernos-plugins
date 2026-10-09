"""A LiveKit TTS that speaks a member's cloned voice, held by the clone provider (see call_voice.py)."""

from __future__ import annotations

import asyncio

from livekit.agents import APIConnectOptions, tts, utils

from call_voice import ELEVEN_BASE, SAMPLE_RATE, render_eleven_pcm

DEFAULT_CONN = APIConnectOptions(max_retry=1, retry_interval=1.0, timeout=50.0)


class CloneTTS(tts.TTS):
    def __init__(self, api_key: str, voice_id: str, base: str = ELEVEN_BASE, model: str = "") -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=SAMPLE_RATE,
            num_channels=1,
        )
        self._key = api_key
        self._voice_id = voice_id
        self._base = base
        self._model = model

    @property
    def model(self) -> str:
        return "elevenlabs-cloned-voice"

    @property
    def provider(self) -> str:
        return "elevenlabs"

    def synthesize(self, text: str, *, conn_options: APIConnectOptions = DEFAULT_CONN) -> tts.ChunkedStream:
        return _CloneStream(tts=self, input_text=text, conn_options=conn_options)


class _CloneStream(tts.ChunkedStream):
    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        voice: CloneTTS = self._tts  # type: ignore[assignment]
        pcm = await asyncio.to_thread(render_eleven_pcm, voice._key, voice._voice_id, self._input_text, voice._base, model=voice._model)
        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=SAMPLE_RATE,
            num_channels=1,
            mime_type="audio/pcm",
            frame_size_ms=100,
        )
        output_emitter.push(pcm)
        output_emitter.flush()
