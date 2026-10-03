"""Local TTS for LiveKit Agents — macOS `say`, no API key, no network.

Proves that the "our own voice" lane of the Kybernos plan (lot G engines) can feed
an AgentSession, and therefore an avatar, without a cloud TTS vendor.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import wave

from livekit.agents import APIConnectOptions, tts, utils

SAMPLE_RATE = 24_000
DEFAULT_CONN = APIConnectOptions(max_retry=3, retry_interval=2.0, timeout=10.0)


class LocalSayTTS(tts.TTS):
    def __init__(self, voice: str = "Thomas", rate: int = 180) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=SAMPLE_RATE,
            num_channels=1,
        )
        self._voice = voice
        self._rate = rate

    @property
    def model(self) -> str:
        return "macos-say"

    @property
    def provider(self) -> str:
        return "local"

    def synthesize(self, text: str, *, conn_options: APIConnectOptions = DEFAULT_CONN) -> tts.ChunkedStream:
        return _SayChunkedStream(
            tts=self, input_text=text, conn_options=conn_options,
            voice=self._voice, rate=self._rate,
        )


class _SayChunkedStream(tts.ChunkedStream):
    def __init__(self, *, voice: str, rate: int, **kwargs) -> None:
        super().__init__(**kwargs)
        self._voice = voice
        self._rate = rate

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        pcm = await asyncio.to_thread(_render_pcm, self._input_text, self._voice, self._rate)
        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=SAMPLE_RATE,
            num_channels=1,
            mime_type="audio/pcm",
            frame_size_ms=100,
        )
        output_emitter.push(pcm)
        output_emitter.flush()


def _render_pcm(text: str, voice: str, rate: int) -> bytes:
    """`say` -> AIFF -> afconvert -> 24 kHz mono PCM16, header stripped via `wave`."""
    with tempfile.TemporaryDirectory() as td:
        aiff = os.path.join(td, "a.aiff")
        wav = os.path.join(td, "a.wav")
        subprocess.run(
            ["/usr/bin/say", "-v", voice, "-r", str(rate), "-o", aiff, text],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["/usr/bin/afconvert", "-f", "WAVE", "-d", f"LEI16@{SAMPLE_RATE}", "-c", "1", aiff, wav],
            check=True, capture_output=True,
        )
        with wave.open(wav, "rb") as w:
            assert w.getframerate() == SAMPLE_RATE, w.getframerate()
            return w.readframes(w.getnframes())
