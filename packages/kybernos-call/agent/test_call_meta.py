"""Tests of call_meta.py (who a call is with). Standard library only.

    python3 test_call_meta.py
"""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from call_meta import (CallMeta, fetch_speech, instructions, parse_job_metadata, speakable, speech_url,
                       stt_options, utterance_payload)


class ParseJobMetadata(unittest.TestCase):
    def test_reads_the_job_metadata(self):
        raw = json.dumps({"sessionId": "session-aaaaaaaa", "kyberId": "team-1", "roleId": "m1",
                          "name": "Alice", "mode": "video", "language": "es"})
        meta = parse_job_metadata(raw, {})
        self.assertEqual(meta, CallMeta("session-aaaaaaaa", "team-1", "m1", "Alice", "video", "es"))

    def test_two_calls_two_identities(self):
        # The point of the metadata: the second call is not the first one.
        a = parse_job_metadata(json.dumps({"sessionId": "session-aaaaaaaa", "name": "Alice"}), {})
        b = parse_job_metadata(json.dumps({"sessionId": "session-bbbbbbbb", "name": "Bob"}), {})
        self.assertNotEqual(a.session_id, b.session_id)
        self.assertEqual((a.name, b.name), ("Alice", "Bob"))

    def test_the_environment_is_only_a_fallback(self):
        env = {"KYBER_SESSION_ID": "session-fromenv", "KYBER_ID": "team-env"}
        self.assertEqual(parse_job_metadata("", env).session_id, "session-fromenv")
        self.assertEqual(parse_job_metadata("", env).kyber_id, "team-env")
        raw = json.dumps({"sessionId": "session-fromjob"})
        self.assertEqual(parse_job_metadata(raw, env).session_id, "session-fromjob")

    def test_bad_metadata_never_raises(self):
        for raw in (None, "", "not json", "[]", "42", '{"mode": 7, "language": 3, "name": {}}'):
            meta = parse_job_metadata(raw, {})
            self.assertIsInstance(meta, CallMeta)
            self.assertEqual(meta.session_id, "")

    def test_mode_defaults_to_the_old_switch(self):
        self.assertEqual(parse_job_metadata("", {}).mode, "video")
        self.assertEqual(parse_job_metadata("", {"KYBER_VISAGE": "0"}).mode, "voice")
        self.assertEqual(parse_job_metadata('{"mode": "voice"}', {}).mode, "voice")
        self.assertEqual(parse_job_metadata('{"mode": "hologram"}', {"KYBER_VISAGE": "0"}).mode, "voice")

    def test_language(self):
        self.assertEqual(parse_job_metadata("", {}).language, "fr")  # a hand-started worker keeps its old default
        self.assertEqual(parse_job_metadata("", {"KYBER_LANGUAGE": "en"}).language, "en")
        self.assertEqual(parse_job_metadata('{"language": "auto"}', {}).language, "auto")
        self.assertEqual(parse_job_metadata('{"language": "pt-BR"}', {}).language, "pt-BR")
        self.assertEqual(parse_job_metadata('{"language": "Klingon!"}', {}).language, "auto")

    def test_long_values_are_cut(self):
        meta = parse_job_metadata(json.dumps({"name": "x" * 500, "kyberId": "k" * 500}), {})
        self.assertEqual(len(meta.name), 60)
        self.assertEqual(len(meta.kyber_id), 64)


class SttOptions(unittest.TestCase):
    def test_auto_detects_the_language(self):
        self.assertTrue(stt_options(CallMeta(language="auto"))["detect_language"])

    def test_a_named_language_is_sent_without_its_region(self):
        self.assertEqual(stt_options(CallMeta(language="pt-BR")), {"language": "pt", "detect_language": False})
        self.assertEqual(stt_options(CallMeta(language="fr")), {"language": "fr", "detect_language": False})


class Instructions(unittest.TestCase):
    def test_speaks_as_the_member_in_the_language(self):
        text = instructions(CallMeta(name="Alice", language="es"))
        self.assertIn("You are Alice", text)
        self.assertIn("Answer in Spanish", text)

    def test_auto_follows_the_speaker(self):
        self.assertIn("the language the user speaks", instructions(CallMeta(language="auto")))

    def test_without_a_name(self):
        self.assertIn("You are the Kyber", instructions(CallMeta()))

    def test_an_unknown_code_is_passed_through(self):
        self.assertIn("Answer in sv", instructions(CallMeta(language="sv")))

    def test_the_override_wins(self):
        self.assertEqual(instructions(CallMeta(name="Alice"), "Say hello."), "Say hello.")


class UtterancePayload(unittest.TestCase):
    def test_goes_to_this_calls_session(self):
        meta = CallMeta(session_id="session-aaaaaaaa", kyber_id="team-1", role_id="m1")
        self.assertEqual(utterance_payload(meta, "hello"),
                         {"sessionId": "session-aaaaaaaa", "text": "hello", "kyberId": "team-1", "roleId": "m1"})

    def test_a_call_without_a_session_writes_nowhere(self):
        self.assertIsNone(utterance_payload(CallMeta(), "hello"))


class Brain(unittest.TestCase):
    def test_session_brain_needs_a_session(self):
        self.assertEqual(parse_job_metadata('{"brain": "session", "sessionId": "session-aaaaaaaa"}', {}).brain, "session")
        self.assertEqual(parse_job_metadata('{"brain": "session"}', {}).brain, "voice")
        self.assertEqual(parse_job_metadata('{"sessionId": "session-aaaaaaaa"}', {}).brain, "voice")
        self.assertEqual(parse_job_metadata("", {"KYBER_SESSION_ID": "session-x"}).brain, "voice")
        self.assertEqual(parse_job_metadata('{"brain": "hologram", "sessionId": "s"}', {}).brain, "voice")


class Speakable(unittest.TestCase):
    def test_plain_text_is_kept(self):
        self.assertEqual(speakable("Europe grows faster. North America follows."), "Europe grows faster. North America follows.")

    def test_what_a_voice_cannot_say_is_dropped(self):
        text = ("## Summary\n\nEurope leads.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n"
                "- first point\n- second point\n\n```js\nconsole.log(1)\n```\nSee [the doc](https://x.io/doc) now.")
        said = speakable(text)
        self.assertEqual(said, "Summary. Europe leads. first point. second point. See the doc now.")
        for forbidden in ("|", "```", "console", "http", "##", "- "):
            self.assertNotIn(forbidden, said)

    def test_only_code_or_a_table_says_nothing(self):
        self.assertEqual(speakable("```python\nprint(1)\n```"), "")
        self.assertEqual(speakable("| a | b |\n|---|---|\n| 1 | 2 |"), "")
        self.assertEqual(speakable("   \n  "), "")
        self.assertEqual(speakable(None), "")
        self.assertEqual(speakable(42), "")

    def test_a_long_answer_is_cut_at_a_sentence(self):
        text = " ".join("Sentence number %d is here." % i for i in range(1, 80))
        said = speakable(text, limit=200)
        self.assertLessEqual(len(said), 200)
        self.assertTrue(said.endswith("."))
        self.assertTrue(said.startswith("Sentence number 1 is here."))
        self.assertIn(said[-12:-1], text)

    def test_one_endless_sentence_is_cut_at_a_word(self):
        said = speakable("word " * 400, limit=100)
        self.assertLessEqual(len(said), 101)
        self.assertTrue(said.endswith("."))
        self.assertNotIn("wor.", said)


class _Speech(BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):
        _Speech.seen.append({"path": self.path, "origin": self.headers.get("origin")})
        body = json.dumps({"ok": True, "known": True, "items": [{"seq": 1, "kind": "text", "text": "hello"}], "next": 1}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class FetchSpeech(unittest.TestCase):
    def test_url(self):
        self.assertEqual(speech_url("http://127.0.0.1:3080/", "room-1", 4, 20000),
                         "http://127.0.0.1:3080/kybernos-call/speech?room=room-1&after=4&wait=20000")

    def test_asks_the_host_with_its_origin(self):
        server = HTTPServer(("127.0.0.1", 0), _Speech)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            host = "http://127.0.0.1:%d" % server.server_port
            reply = fetch_speech(host, "room-1", 3, 0)
        finally:
            server.shutdown()
            server.server_close()
        self.assertEqual(reply["items"][0]["text"], "hello")
        self.assertEqual(_Speech.seen[-1]["origin"], host)
        self.assertIn("room=room-1&after=3&wait=0", _Speech.seen[-1]["path"])

    def test_a_network_error_raises(self):
        with self.assertRaises(Exception):
            fetch_speech("http://127.0.0.1:1", "room-1", 0, 0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
