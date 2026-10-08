"""Tests of call_voice.py: which voice a call asks the app's voice engine for, and what comes back.

The decisions and the request use the standard library only. Decoding needs PyAV (a dependency of
livekit-agents): those tests are skipped without it.

    python3 test_call_voice.py
"""

import base64
import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from call_meta import CallMeta, VoiceChoice, parse_job_metadata
from call_voice import audio_bytes, decode_pcm, reply_language, speak_request, two_letters, voice_request

try:
    import av
    import numpy as np
    HAVE_AV = True
except Exception:  # PyAV is not installed here
    HAVE_AV = False


def make_m4a(seconds: float = 0.5, rate: int = 24000) -> bytes:
    """A real AAC-in-MP4 clip (a sine), like what the app's voice engine renders."""
    buffer = io.BytesIO()
    out = av.open(buffer, "w", format="mp4")
    stream = out.add_stream("aac", rate=rate)
    stream.layout = "mono"
    total = int(seconds * rate)
    samples = (np.sin(2 * np.pi * 440 * np.arange(total) / rate) * 12000).astype(np.int16)
    for start in range(0, total, 1024):
        chunk = samples[start:start + 1024].reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(chunk, format="s16", layout="mono")
        frame.sample_rate = rate
        for packet in stream.encode(frame):
            out.mux(packet)
    for packet in stream.encode(None):
        out.mux(packet)
    out.close()
    return buffer.getvalue()


class VoiceParsing(unittest.TestCase):
    def test_an_engine_voice(self):
        meta = parse_job_metadata(json.dumps({"voice": {"engine": "edge", "voice": "fr-FR-DeniseNeural", "lang": "fr-FR"}}), {})
        self.assertEqual(meta.voice, VoiceChoice("edge", "fr-FR-DeniseNeural", "fr"))

    def test_a_recording_no_engine_speaks(self):
        self.assertEqual(parse_job_metadata(json.dumps({"voice": {"custom": True}}), {}).voice, VoiceChoice(custom=True))

    def test_names_with_spaces_and_brackets_pass(self):
        meta = parse_job_metadata(json.dumps({"voice": {"engine": "say", "voice": "Eddy (English (UK))", "lang": "en"}}), {})
        self.assertEqual(meta.voice.voice, "Eddy (English (UK))")

    def test_bad_voices_are_dropped(self):
        for bad in (None, "edge", [], {}, {"engine": "Edge!", "voice": "x"}, {"engine": "edge", "voice": ""},
                    {"engine": "edge", "voice": "a/b"}, {"engine": "edge", "voice": "x" * 101}, {"engine": 3, "voice": "x"}):
            self.assertIsNone(parse_job_metadata(json.dumps({"voice": bad}), {}).voice, bad)


class Languages(unittest.TestCase):
    def test_two_letters(self):
        for given, expected in (("fr", "fr"), ("FR", "fr"), ("fr-FR", "fr"), ("pt_BR", "pt"), ("fra", "fr"),
                                ("french", ""), ("auto", ""), ("", ""), (None, ""), (5, ""), ("x", "")):
            self.assertEqual(two_letters(given), expected, given)

    def test_a_named_language_wins_over_what_was_heard(self):
        self.assertEqual(reply_language(CallMeta(language="es"), "fr"), "es")

    def test_auto_follows_what_was_heard(self):
        self.assertEqual(reply_language(CallMeta(language="auto"), "de-DE"), "de")
        self.assertEqual(reply_language(CallMeta(language="auto"), ""), "")


class VoiceRequest(unittest.TestCase):
    denise = VoiceChoice("edge", "fr-FR-DeniseNeural", "fr")

    def test_no_voice_chosen_is_the_apps_default(self):
        self.assertEqual(voice_request(CallMeta(), ""), {})
        self.assertEqual(voice_request(CallMeta(), "es"), {"lang": "es"})

    def test_a_recording_falls_back_to_the_default_voice(self):
        self.assertEqual(voice_request(CallMeta(voice=VoiceChoice(custom=True)), "fr"), {"lang": "fr"})

    def test_the_members_voice_when_it_speaks_the_language(self):
        self.assertEqual(voice_request(CallMeta(voice=self.denise), "fr"),
                         {"engine": "edge", "voice": "fr-FR-DeniseNeural", "lang": "fr"})

    def test_the_members_voice_when_the_language_is_not_known_yet(self):
        self.assertEqual(voice_request(CallMeta(voice=self.denise), ""),
                         {"engine": "edge", "voice": "fr-FR-DeniseNeural", "lang": "fr"})

    def test_another_language_gets_a_voice_of_that_language_on_the_same_engine(self):
        self.assertEqual(voice_request(CallMeta(voice=self.denise), "es"), {"engine": "edge", "lang": "es"})

    def test_a_multilingual_voice_is_kept_for_any_language(self):
        multi = VoiceChoice("edge", "fr-FR-VivienneMultilingualNeural", "fr")
        self.assertEqual(voice_request(CallMeta(voice=multi), "es"),
                         {"engine": "edge", "voice": "fr-FR-VivienneMultilingualNeural", "lang": "es"})


class _Engine(BaseHTTPRequestHandler):
    seen = []
    reply = {"ok": True, "audio": "data:audio/mp4;base64," + base64.b64encode(b"hello").decode()}

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        _Engine.seen.append({"path": self.path, "origin": self.headers.get("origin"),
                             "body": json.loads(self.rfile.read(length).decode())})
        body = json.dumps(_Engine.reply).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class SpeakRequest(unittest.TestCase):
    def serve(self):
        server = HTTPServer(("127.0.0.1", 0), _Engine)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        return "http://127.0.0.1:%d" % server.server_port

    def test_asks_the_apps_engine_with_its_origin(self):
        host = self.serve()
        _Engine.reply = {"ok": True, "audio": "data:audio/mp4;base64," + base64.b64encode(b"hello").decode()}
        answer = speak_request(host, "Bonjour.", {"engine": "edge", "voice": "fr-FR-DeniseNeural", "lang": "fr"})
        self.assertEqual(audio_bytes(answer), b"hello")
        seen = _Engine.seen[-1]
        self.assertEqual(seen["path"], "/kybernos/tts/speak")
        self.assertEqual(seen["origin"], host)
        self.assertEqual(seen["body"], {"text": "Bonjour.", "engine": "edge", "voice": "fr-FR-DeniseNeural", "lang": "fr"})

    def test_a_refusal_raises_with_the_engines_reason(self):
        host = self.serve()
        _Engine.reply = {"ok": False, "error": "aucun moteur n a pu lire le texte"}
        with self.assertRaisesRegex(RuntimeError, "aucun moteur"):
            speak_request(host, "x", {})

    def test_audio_that_is_not_a_data_url_raises(self):
        with self.assertRaises(RuntimeError):
            audio_bytes({"audio": "http://elsewhere/x.m4a"})

    def test_no_host_raises(self):
        with self.assertRaises(Exception):
            speak_request("http://127.0.0.1:1", "x", {}, timeout=1)


@unittest.skipUnless(HAVE_AV, "PyAV is not installed: run this with the worker's venv")
class Decoding(unittest.TestCase):
    def test_m4a_becomes_mono_pcm_at_24k(self):
        pcm = decode_pcm(make_m4a(0.5))
        seconds = len(pcm) / 2 / 24000
        self.assertAlmostEqual(seconds, 0.5, delta=0.15)
        samples = np.frombuffer(pcm, dtype=np.int16)
        self.assertGreater(int(np.abs(samples).max()), 3000)  # a real signal, not silence

    def test_another_sample_rate_is_resampled(self):
        pcm = decode_pcm(make_m4a(0.5, rate=48000))
        self.assertAlmostEqual(len(pcm) / 2 / 24000, 0.5, delta=0.15)

    def test_garbage_raises(self):
        with self.assertRaises(Exception):
            decode_pcm(b"this is not audio")


if __name__ == "__main__":
    unittest.main(verbosity=1)
