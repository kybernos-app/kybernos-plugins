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
    from call_meta import CallLimits, CallMeta, CallState, VoiceChoice
    from clone_tts import CloneTTS
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


class _Provider(BaseHTTPRequestHandler):
    seen = []
    audio = b""

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        _Provider.seen.append({"path": self.path, "key": self.headers.get("xi-api-key"), "body": json.loads(self.rfile.read(length).decode())})
        self.send_response(200)
        self.send_header("content-type", "audio/mpeg")
        self.send_header("content-length", str(len(_Provider.audio)))
        self.end_headers()
        self.wfile.write(_Provider.audio)

    def log_message(self, *args):
        pass


class _Clock:
    t = 1000.0

    def __call__(self):
        return self.t


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class ClonedVoice(unittest.TestCase):
    def test_a_member_with_a_clone_speaks_with_it_first(self):
        _Provider.seen = []
        _Provider.audio = make_m4a(0.5)
        server = HTTPServer(("127.0.0.1", 0), _Provider)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))

        async def go():
            voice = CloneTTS("xi-key-123456", "RemoteVoice777", base="http://127.0.0.1:%d" % server.server_port)
            return await _collect(voice.synthesize("Hola a todos."))

        frames, samples = asyncio.run(go())
        self.assertGreater(frames, 0)
        self.assertAlmostEqual(samples / 24000, 0.5, delta=0.2)
        self.assertEqual(_Provider.seen[-1]["path"], "/v1/text-to-speech/RemoteVoice777?output_format=mp3_44100_128")
        self.assertEqual(_Provider.seen[-1]["body"]["text"], "Hola a todos.")

    def test_the_chain_puts_the_clone_first_and_the_apps_engine_behind(self):
        meta = CallMeta(voice=VoiceChoice(custom=True, remote_provider="elevenlabs", remote_id="RemoteVoice777"))
        os.environ["ELEVENLABS_API_KEY"] = "xi-key-123456"

        async def build():
            return worker._build_tts(meta)

        try:
            voice, app_voice = asyncio.run(build())
        finally:
            del os.environ["ELEVENLABS_API_KEY"]
        self.assertIsInstance(app_voice, HostTTS)
        self.assertEqual(type(voice).__name__, "FallbackAdapter")
        self.assertIsInstance(voice._tts_instances[0], CloneTTS)
        self.assertIsInstance(voice._tts_instances[1], HostTTS)

    def test_without_the_key_or_the_clone_the_apps_engine_speaks(self):
        async def build(meta):
            return worker._build_tts(meta)

        os.environ.pop("ELEVENLABS_API_KEY", None)
        voice, _ = asyncio.run(build(CallMeta(voice=VoiceChoice(custom=True, remote_provider="elevenlabs", remote_id="RemoteVoice777"))))
        self.assertFalse(any(isinstance(t, CloneTTS) for t in getattr(voice, "_tts_instances", [voice])))
        os.environ["ELEVENLABS_API_KEY"] = "xi-key-123456"
        try:
            voice, _ = asyncio.run(build(CallMeta(voice=VoiceChoice(custom=True))))
        finally:
            del os.environ["ELEVENLABS_API_KEY"]
        self.assertFalse(any(isinstance(t, CloneTTS) for t in getattr(voice, "_tts_instances", [voice])))


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class OnABusyMachine(unittest.TestCase):
    def test_a_busy_machine_does_not_make_the_worker_refuse_the_call(self):
        # LiveKit's default marks the worker "unavailable" above 70 % CPU: on a laptop at full load the call never connected.
        load = worker.server.load_fnc
        self.assertEqual(load(), 0.0)

    def test_it_does_not_keep_ten_warm_processes(self):
        self.assertLessEqual(worker.server._num_idle_processes, 2)


class _Say:
    def __init__(self):
        self.said = []

    def say(self, text, **kwargs):
        self.said.append(text)


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class WhileTheSessionWorks(unittest.TestCase):
    def test_one_moment_is_said_once_when_nothing_comes(self):
        clock = _Clock()
        state = CallState(clock)
        state.turn_started()
        voice = _Say()
        real_sleep = worker.asyncio.sleep

        async def fast_sleep(_):
            clock.t += 1.0
            await real_sleep(0)

        worker.asyncio.sleep = fast_sleep

        async def go():
            task = asyncio.create_task(worker._say_while_waiting(voice, state, lambda: "es"))
            await real_sleep(0.05)
            task.cancel()

        try:
            asyncio.run(go())
        finally:
            worker.asyncio.sleep = real_sleep
        self.assertEqual(voice.said, ["Un momento, lo estoy mirando."])

    def test_nothing_is_said_when_the_answer_is_already_speaking(self):
        clock = _Clock()
        state = CallState(clock)
        state.turn_started()
        state.reply_spoken()
        voice = _Say()
        real_sleep = worker.asyncio.sleep

        async def fast_sleep(_):
            clock.t += 1.0
            await real_sleep(0)

        worker.asyncio.sleep = fast_sleep

        async def go():
            task = asyncio.create_task(worker._say_while_waiting(voice, state, lambda: "fr"))
            await real_sleep(0.05)
            task.cancel()

        try:
            asyncio.run(go())
        finally:
            worker.asyncio.sleep = real_sleep
        self.assertEqual(voice.said, [])

    def test_the_end_of_the_turn_comes_through_the_feed(self):
        clock = _Clock()
        state = CallState(clock)
        state.turn_started()
        voice = _Say()
        replies = [{"known": True, "next": 2, "items": [{"seq": 1, "kind": "text", "text": "Done."}, {"seq": 2, "kind": "end", "reason": "end-turn"}]},
                   {"known": False, "items": [], "next": 2}]
        original = worker.fetch_speech
        worker.fetch_speech = lambda host, room, after, wait: replies.pop(0)
        try:
            asyncio.run(worker._speak_session(voice, "room-1", state))
        finally:
            worker.fetch_speech = original
        self.assertEqual(voice.said, ["Done."])
        self.assertFalse(state.busy())
        self.assertEqual(state.inject_mode(), "queue")


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class Limits(unittest.TestCase):
    def test_a_silent_call_deletes_its_room(self):
        clock = _Clock()
        state = CallState(clock)
        clock.t += 400
        deleted = []

        class Ctx:
            async def delete_room(self):
                deleted.append(True)

            def shutdown(self, reason=""):
                deleted.append(reason)

        real_sleep = worker.asyncio.sleep

        async def instant(_):
            await real_sleep(0)

        worker.asyncio.sleep = instant
        try:
            asyncio.run(worker._watch_limits(Ctx(), state, CallMeta(limits=CallLimits(silence_ms=300000, max_ms=3600000))))
        finally:
            worker.asyncio.sleep = real_sleep
        self.assertEqual(deleted, [True])


class _Capture(BaseHTTPRequestHandler):
    seen = []

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        _Capture.seen.append(json.loads(self.rfile.read(length).decode()))
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok": true, "accepted": true}')

    def log_message(self, *args):
        pass


@unittest.skipUnless(HAVE_LIVEKIT, "livekit-agents is not installed: run this with the worker's venv")
class Injection(unittest.TestCase):
    def test_the_words_go_to_this_calls_session_with_the_mode(self):
        server = HTTPServer(("127.0.0.1", 0), _Capture)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        original = worker.HOST
        worker.HOST = "http://127.0.0.1:%d" % server.server_port
        meta = CallMeta(session_id="session-aaaaaaaa", kyber_id="team-1", role_id="m1", brain="session")
        try:
            worker._inject(meta, "also check the third quarter", "steer")
            worker._inject(meta, "and then summarise", "queue")
            worker._inject(CallMeta(), "no session: nowhere to go", "queue")
        finally:
            worker.HOST = original
        self.assertEqual([m["mode"] for m in _Capture.seen], ["steer", "queue"])
        self.assertEqual(_Capture.seen[0]["sessionId"], "session-aaaaaaaa")
        self.assertEqual(_Capture.seen[0]["text"], "also check the third quarter")


if __name__ == "__main__":
    unittest.main(verbosity=1)
