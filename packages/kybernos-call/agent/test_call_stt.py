"""Listening through the host (call_stt.py): no LiveKit, no network. python3 test_call_stt.py"""

import base64
import json
import unittest

from call_meta import CallMeta
from call_stt import language_hint, listen_request

WAV = b"RIFF" + b"\x00" * 60


class FakeReply:
    def __init__(self, body):
        self._body = json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self._body


def opener_for(answer, seen):
    def opener(request, timeout=0):
        seen.append({"url": request.full_url, "body": json.loads(request.data.decode("utf-8")), "headers": dict(request.header_items())})
        return FakeReply(answer)
    return opener


class ListenRequest(unittest.TestCase):
    def test_a_model_of_a_provider_is_asked_through_the_host(self):
        seen = []
        text = listen_request("http://127.0.0.1:3080/", "models", "xiaomi-token-plan-ams:mimo-v2.5-asr", WAV, "fr", opener_for({"ok": True, "text": " bonjour "}, seen))
        self.assertEqual(text, "bonjour")
        self.assertEqual(seen[0]["url"], "http://127.0.0.1:3080/kybernos/models/audio/listen")
        self.assertEqual(seen[0]["body"]["provider"], "xiaomi-token-plan-ams")
        self.assertEqual(seen[0]["body"]["model"], "mimo-v2.5-asr")
        self.assertEqual(base64.b64decode(seen[0]["body"]["audio"]), WAV)
        self.assertEqual(seen[0]["body"]["language"], "fr")
        self.assertEqual(seen[0]["headers"]["Origin"], "http://127.0.0.1:3080")

    def test_the_apps_dictation_takes_a_wav_data_url(self):
        seen = []
        text = listen_request("http://127.0.0.1:3080", "app", "", WAV, "", opener_for({"ok": True, "text": "salut"}, seen))
        self.assertEqual(text, "salut")
        self.assertEqual(seen[0]["url"], "http://127.0.0.1:3080/kybernos/voice/transcribe")
        self.assertTrue(seen[0]["body"]["audio"].startswith("data:audio/wav;base64,"))
        self.assertNotIn("language", seen[0]["body"])

    def test_a_failure_says_why(self):
        with self.assertRaisesRegex(RuntimeError, "no key is set"):
            listen_request("http://h", "models", "p:m", WAV, "", opener_for({"ok": False, "error": "no key is set for this provider"}, []))
        with self.assertRaisesRegex(RuntimeError, "no listening model is chosen"):
            listen_request("http://h", "models", "", WAV, "", opener_for({}, []))
        with self.assertRaisesRegex(RuntimeError, "unknown listening provider"):
            listen_request("http://h", "nobody", "x", WAV, "", opener_for({}, []))
        with self.assertRaises(RuntimeError):
            listen_request("http://h", "app", "", WAV, "", opener_for([1], []))

    def test_speech_too_short_is_not_a_failure(self):
        self.assertEqual(listen_request("http://h", "app", "", WAV, "", opener_for({"ok": False, "error": "audio inaudible ou trop court pour le modèle"}, [])), "")
        self.assertEqual(listen_request("http://h", "models", "p:m", WAV, "", opener_for({"ok": False, "error": "audio vide"}, [])), "")
        # a word that merely contains "vide" is a failure like any other
        with self.assertRaises(RuntimeError):
            listen_request("http://h", "models", "p:m", WAV, "", opener_for({"ok": False, "error": "no key for this provider"}, []))


class Hints(unittest.TestCase):
    def test_a_named_language_is_two_letters_and_auto_is_left_to_the_provider(self):
        self.assertEqual(language_hint(CallMeta(language="fr-FR")), "fr")
        self.assertEqual(language_hint(CallMeta(language="auto")), "")


if __name__ == "__main__":
    unittest.main(verbosity=1)
