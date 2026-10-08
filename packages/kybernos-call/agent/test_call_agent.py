"""The worker's LiveKit-facing behaviour: who answers. Needs livekit-agents (the worker's venv); skipped without it.

    <venv>/bin/python test_call_agent.py
"""

import asyncio
import base64
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("GROQ_API_KEY", "test-key-not-used")

try:
    import agent as worker
    from livekit.agents import APIConnectOptions, StopResponse, tts, utils
    from call_meta import CallMeta, VoiceChoice
    from host_tts import HostTTS
    from test_call_voice import make_m4a
    HAVE_LIVEKIT = True
except Exception:  # livekit-agents is not installed here
    HAVE_LIVEKIT = False


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class CallAgent(unittest.TestCase):
    def test_with_a_session_the_small_model_does_not_answer(self):
        agent = worker.CallAgent(instructions="x", session_brain=True)
        with self.assertRaises(StopResponse):
            asyncio.run(agent.on_user_turn_completed(None, None))

    def test_without_a_session_it_does(self):
        agent = worker.CallAgent(instructions="x", session_brain=False)
        self.assertIsNone(asyncio.run(agent.on_user_turn_completed(None, None)))

    def test_the_brief_is_the_calls(self):
        agent = worker.CallAgent(instructions="You are Alice.", session_brain=False)
        self.assertEqual(agent.instructions, "You are Alice.")


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class SpeakSession(unittest.TestCase):
    def test_it_speaks_the_sessions_text_and_not_the_rest(self):
        said = []

        class FakeSession:
            def say(self, text, **kwargs):
                said.append(text)

        replies = [
            {"known": True, "next": 3, "items": [
                {"seq": 1, "kind": "tool", "name": "read_file"},
                {"seq": 2, "kind": "text", "text": "## Result\n\nEurope leads.\n\n```js\ncode()\n```"},
                {"seq": 3, "kind": "end", "reason": "end-turn"},
            ]},
            {"known": False, "items": [], "next": 3},
        ]
        asked = []

        def fake_fetch(host, room, after, wait):
            asked.append((room, after))
            return replies.pop(0)

        original = worker.fetch_speech
        worker.fetch_speech = fake_fetch
        try:
            asyncio.run(worker._speak_session(FakeSession(), "room-1"))
        finally:
            worker.fetch_speech = original
        self.assertEqual(said, ["Result. Europe leads."])
        self.assertEqual(asked, [("room-1", 0), ("room-1", 3)])

    def test_it_gives_up_after_repeated_failures(self):
        class FakeSession:
            def say(self, text, **kwargs):
                raise AssertionError("nothing to say")

        calls = []

        def broken(host, room, after, wait):
            calls.append(1)
            raise OSError("host down")

        original, sleep = worker.fetch_speech, worker.asyncio.sleep
        worker.fetch_speech = broken

        async def no_sleep(_):
            return None

        worker.asyncio.sleep = no_sleep
        try:
            asyncio.run(worker._speak_session(FakeSession(), "room-1"))
        finally:
            worker.fetch_speech, worker.asyncio.sleep = original, sleep
        self.assertEqual(len(calls), 5)


class _Engine(BaseHTTPRequestHandler):
    seen = []
    audio = b""
    fail = False

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        _Engine.seen.append(json.loads(self.rfile.read(length).decode()))
        body = json.dumps({"ok": False, "error": "no engine ready"} if _Engine.fail else
                          {"ok": True, "audio": "data:audio/mp4;base64," + base64.b64encode(_Engine.audio).decode()}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if HAVE_LIVEKIT:
    class _Stub(tts.TTS):
        """A second voice behind the app's engine (stands for macOS `say`): half a second of silence."""

        def __init__(self):
            super().__init__(capabilities=tts.TTSCapabilities(streaming=False), sample_rate=24000, num_channels=1)

        def synthesize(self, text, *, conn_options=APIConnectOptions()):
            return _StubStream(tts=self, input_text=text, conn_options=conn_options)

    class _StubStream(tts.ChunkedStream):
        async def _run(self, output_emitter):
            output_emitter.initialize(request_id=utils.shortuuid(), sample_rate=24000, num_channels=1, mime_type="audio/pcm", frame_size_ms=100)
            output_emitter.push(b"\x00\x00" * 12000)
            output_emitter.flush()


async def _collect(stream):
    frames = 0
    samples = 0
    async for event in stream:
        frames += 1
        samples += event.frame.samples_per_channel
    return frames, samples


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class VoiceEngine(unittest.TestCase):
    def setUp(self):
        _Engine.seen = []
        _Engine.fail = False
        _Engine.audio = make_m4a(0.5)
        self.server = HTTPServer(("127.0.0.1", 0), _Engine)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.host = "http://127.0.0.1:%d" % self.server.server_port
        self.addCleanup(lambda: (self.server.shutdown(), self.server.server_close()))

    # LiveKit's objects want a running event loop when they are built: everything is built inside one.
    def test_a_reply_is_spoken_through_the_apps_engine_as_audio_frames(self):
        async def go():
            voice = HostTTS(self.host, CallMeta(language="auto", voice=VoiceChoice("edge", "fr-FR-DeniseNeural", "fr")))
            return await _collect(voice.synthesize("Bonjour tout le monde."))

        frames, samples = asyncio.run(go())
        self.assertGreater(frames, 0)
        self.assertAlmostEqual(samples / 24000, 0.5, delta=0.2)
        self.assertEqual(_Engine.seen[-1], {"text": "Bonjour tout le monde.", "engine": "edge", "voice": "fr-FR-DeniseNeural", "lang": "fr"})

    def test_the_reply_follows_the_language_the_user_just_spoke(self):
        async def go():
            voice = HostTTS(self.host, CallMeta(language="auto", voice=VoiceChoice("edge", "fr-FR-DeniseNeural", "fr")))
            voice.hear("es-ES")
            await _collect(voice.synthesize("Hola."))
            spanish = dict(_Engine.seen[-1])
            voice.hear("fr")
            await _collect(voice.synthesize("Salut."))
            return spanish, dict(_Engine.seen[-1])

        spanish, french = asyncio.run(go())
        self.assertEqual(spanish, {"text": "Hola.", "engine": "edge", "lang": "es"})
        self.assertEqual(french["voice"], "fr-FR-DeniseNeural")

    def test_a_call_in_a_named_language_ignores_what_was_heard(self):
        async def go():
            voice = HostTTS(self.host, CallMeta(language="de"))
            voice.hear("fr")
            await _collect(voice.synthesize("Hallo."))

        asyncio.run(go())
        self.assertEqual(_Engine.seen[-1]["lang"], "de")

    def test_when_the_engine_fails_the_voice_behind_it_speaks(self):
        _Engine.fail = True

        async def go():
            both = tts.FallbackAdapter([HostTTS(self.host, CallMeta()), _Stub()])
            return await _collect(both.synthesize("Still here."))

        frames, samples = asyncio.run(go())
        self.assertGreater(frames, 0)
        self.assertAlmostEqual(samples / 24000, 0.5, delta=0.2)
        self.assertTrue(_Engine.seen, "the app's engine was tried first")

    def test_the_old_env_value_say_keeps_working_as_the_apps_engine(self):
        async def build():
            return worker._build_tts(CallMeta())

        os.environ["KYBER_TTS"] = "say"
        try:
            voice, app_voice = asyncio.run(build())
        finally:
            del os.environ["KYBER_TTS"]
        self.assertIsNotNone(app_voice)
        self.assertIsInstance(app_voice, HostTTS)

    def test_groq_and_legacy_still_force_the_old_voices(self):
        async def build():
            return worker._build_tts(CallMeta())

        os.environ["KYBER_TTS"] = "legacy"
        try:
            voice, app_voice = asyncio.run(build())
        finally:
            del os.environ["KYBER_TTS"]
        self.assertIsNone(app_voice)
        self.assertEqual(type(voice).__name__, "LocalSayTTS")


if __name__ == "__main__":
    unittest.main(verbosity=1)
