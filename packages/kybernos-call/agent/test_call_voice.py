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
from lang_guess import guess_language
from call_voice import audio_bytes, decode_pcm, eleven_request, render_eleven_pcm, reply_language, speak_request, two_letters, voice_request

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

    def test_an_accented_voice_name_is_kept(self):
        # The app's own French voice is "Amélie": checked as ASCII, it was dropped and the call used another voice.
        for name in ("Amélie", "Mónica", "Tünde", "Eddy (French (France))"):
            meta = parse_job_metadata(json.dumps({"voice": {"engine": "say", "voice": name, "lang": "fr"}}), {})
            self.assertEqual(meta.voice, VoiceChoice("say", name, "fr"), name)
        self.assertIsNone(parse_job_metadata(json.dumps({"voice": {"engine": "say", "voice": "a\nb"}}), {}).voice)

    def test_bad_voices_are_dropped(self):
        for bad in (None, "edge", [], {}, {"engine": "Edge!", "voice": "x"}, {"engine": "edge", "voice": ""},
                    {"engine": "edge", "voice": "a/b"}, {"engine": "edge", "voice": "x" * 101}, {"engine": 3, "voice": "x"}):
            self.assertIsNone(parse_job_metadata(json.dumps({"voice": bad}), {}).voice, bad)


class LanguageCodes(unittest.TestCase):
    def test_two_letters(self):
        for given, expected in (("fr", "fr"), ("FR", "fr"), ("fr-FR", "fr"), ("pt_BR", "pt"), ("fra", "fr"),
                                ("french", ""), ("auto", ""), ("", ""), (None, ""), (5, ""), ("x", "")):
            self.assertEqual(two_letters(given), expected, given)

    def test_a_named_language_wins_over_what_was_heard(self):
        self.assertEqual(reply_language(CallMeta(language="es"), "fr"), "es")

    def test_auto_follows_what_was_heard(self):
        self.assertEqual(reply_language(CallMeta(language="auto"), "de-DE"), "de")
        self.assertEqual(reply_language(CallMeta(language="auto"), ""), "")


class GuessLanguage(unittest.TestCase):
    def test_it_tells_the_common_latin_languages_apart(self):
        for text, expected in [
            ("Oui, je t'entends bien ! \U0001f50a \u2014 le canal est bon.", "fr"), ("Allô, tu entends ?", "fr"), ("D'accord.", "fr"),
            ("Yes, I can hear you well.", "en"), ("Hola, \u00bfc\u00f3mo est\u00e1s? Te escucho muy bien.", "es"),
            ("Ich kann dich gut h\u00f6ren, danke.", "de"), ("S\u00ec, ti sento molto bene.", "it"),
            ("Ol\u00e1, eu consigo ouvir voc\u00ea muito bem.", "pt"), ("Ja, ik hoor je goed, dank je.", "nl"),
        ]:
            self.assertEqual(guess_language(text), expected, text)

    def test_the_writing_system_names_its_language(self):
        for text, expected in [("\u0646\u0639\u0645\u060c \u0623\u0633\u0645\u0639\u0643", "ar"), ("\u0414\u0430, \u044f \u0442\u0435\u0431\u044f \u0441\u043b\u044b\u0448\u0443", "ru"),
                               ("\u306f\u3044\u3001\u3088\u304f\u805e\u3053\u3048\u307e\u3059", "ja"), ("\ub124, \uc798 \ub4e4\ub9bd\ub2c8\ub2e4", "ko"), ("\u662f\u7684\uff0c\u6211\u542c\u5f97\u5f88\u6e05\u695a", "zh")]:
            self.assertEqual(guess_language(text), expected)

    def test_when_it_cannot_tell_it_says_so(self):
        for text in ["", "   ", "OK", "123 456", "kybernos-plugin", None, 42]:
            self.assertEqual(guess_language(text), "")


class Languages(unittest.TestCase):
    def test_in_auto_the_words_of_the_reply_decide_the_language(self):
        # The measured failure: an English voice read a French reply, because the speech-to-text gave no language.
        self.assertEqual(reply_language(CallMeta(language="auto"), "", "Oui, je t'entends bien, le canal est bon."), "fr")
        self.assertEqual(reply_language(CallMeta(language="auto"), "fr", "Yes, I can hear you."), "en")

    def test_a_reply_too_short_to_tell_falls_back_on_what_was_heard(self):
        self.assertEqual(reply_language(CallMeta(language="auto"), "de-DE", "OK."), "de")

    def test_a_named_language_is_never_overridden(self):
        self.assertEqual(reply_language(CallMeta(language="es"), "fr", "Oui, je t'entends bien."), "es")


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


class _Provider(BaseHTTPRequestHandler):
    seen = []
    status = 200
    audio = b"audio-bytes"

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        _Provider.seen.append({"path": self.path, "key": self.headers.get("xi-api-key"),
                               "accept": self.headers.get("accept"), "body": json.loads(self.rfile.read(length).decode())})
        self.send_response(_Provider.status)
        self.send_header("content-type", "audio/mpeg")
        self.send_header("content-length", str(len(_Provider.audio)))
        self.end_headers()
        self.wfile.write(_Provider.audio)

    def log_message(self, *args):
        pass


class ElevenRequest(unittest.TestCase):
    def serve(self):
        server = HTTPServer(("127.0.0.1", 0), _Provider)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close()))
        _Provider.status = 200
        return "http://127.0.0.1:%d" % server.server_port

    def test_speaks_in_the_cloned_voice_with_the_multilingual_model(self):
        base = self.serve()
        _Provider.audio = b"fake-mp3"
        out = eleven_request("xi-key-123456", "RemoteVoice777", "Hola, ¿qué tal?", base=base)
        self.assertEqual(out, b"fake-mp3")
        seen = _Provider.seen[-1]
        self.assertEqual(seen["path"], "/v1/text-to-speech/RemoteVoice777?output_format=mp3_44100_128")
        self.assertEqual(seen["key"], "xi-key-123456")
        self.assertEqual(seen["body"], {"text": "Hola, ¿qué tal?", "model_id": "eleven_multilingual_v2"})

    def test_each_failure_says_what_to_do(self):
        base = self.serve()
        for status, words in ((401, "refused the key"), (403, "refused the key"), (404, "no longer exists"), (500, "HTTP 500")):
            _Provider.status = status
            with self.assertRaisesRegex(RuntimeError, words):
                eleven_request("k" * 10, "RemoteVoice777", "x", base=base)

    def test_a_bad_voice_id_is_never_sent(self):
        base = self.serve()
        before = len(_Provider.seen)
        for bad in ("", "../x", "a/b/c/d/e/f", "x", None):
            with self.assertRaises(RuntimeError):
                eleven_request("k" * 10, bad, "x", base=base)
        self.assertEqual(len(_Provider.seen), before)

    @unittest.skipUnless(HAVE_AV, "PyAV is not installed: run this with the worker's venv")
    def test_the_answer_is_decoded_to_pcm(self):
        base = self.serve()
        _Provider.audio = make_m4a(0.4)
        pcm = render_eleven_pcm("k" * 10, "RemoteVoice777", "x", base=base)
        self.assertAlmostEqual(len(pcm) / 2 / 24000, 0.4, delta=0.15)


if __name__ == "__main__":
    unittest.main(verbosity=1)
