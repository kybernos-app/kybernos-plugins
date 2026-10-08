"""Tests of call_meta.py (who a call is with). Standard library only.

    python3 test_call_meta.py
"""

import json
import unittest

from call_meta import CallMeta, instructions, parse_job_metadata, stt_options, utterance_payload


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


if __name__ == "__main__":
    unittest.main(verbosity=1)
