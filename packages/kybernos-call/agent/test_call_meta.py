"""Tests of call_meta.py (who a call is with). Standard library only.

    python3 test_call_meta.py
"""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from call_meta import (CallLimits, CallMeta, CallState, VoiceChoice, fetch_speech, filler, instructions,
                       parse_job_metadata, speakable, speech_url, stt_options, utterance_payload)


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


class ProviderModels(unittest.TestCase):
    def test_the_models_chosen_in_the_settings_reach_the_worker(self):
        meta = parse_job_metadata('{"sttModel": "whisper-large-v3", "cloneModel": "eleven_flash_v2_5"}', {})
        self.assertEqual((meta.stt_model, meta.clone_model), ("whisper-large-v3", "eleven_flash_v2_5"))

    def test_a_model_name_that_is_not_one_is_dropped(self):
        for bad in ("../x", "a b", "", "x" * 65, 3, None, ["a"]):
            meta = parse_job_metadata('{"sttModel": %s}' % json.dumps(bad), {})
            self.assertEqual(meta.stt_model, "", bad)

    def test_without_them_the_workers_defaults_apply(self):
        meta = parse_job_metadata('{"mode": "voice"}', {})
        self.assertEqual((meta.stt_model, meta.clone_model), ("", ""))


class Speakable(unittest.TestCase):
    def test_plain_text_is_kept(self):
        self.assertEqual(speakable("Europe grows faster. North America follows."), "Europe grows faster. North America follows.")

    def test_what_a_voice_cannot_say_is_dropped(self):
        text = ("## Summary\n\nEurope leads, see [the doc](https://x.io/doc).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n"
                "- first point\n- second point\n\n```js\nconsole.log(1)\n```\nMore.")
        said = speakable(text)
        self.assertEqual(said, "Europe leads, see the doc.")  # the heading is not read, the lead is
        for forbidden in ("|", "```", "console", "http", "##", "- ", "first point"):
            self.assertNotIn(forbidden, said)

    def test_only_the_lead_is_said_not_the_menu_under_it(self):
        # The first real call: the answer was "Paris", and a voice then read a menu of kybers and skills.
        text = ("Le capital de la France est Paris. \U0001f1eb\U0001f1f7\n\n"
                "- Kyber `default` : pour une vraie demande de travail \u2014 je le lance ?\n"
                "- Skill `feature-plugin-dsh` : pour une fonctionnalité précise \u2014 je la charge ?\n\n"
                "Autre chose ?")
        self.assertEqual(speakable(text), "Le capital de la France est Paris.")

    def test_a_lead_in_with_a_colon_takes_its_list(self):
        self.assertEqual(speakable("Voici les options :\n- rouge\n- bleu\n\nDis-moi laquelle."), "Voici les options : rouge. bleu.")

    def test_an_answer_that_is_a_list_is_said(self):
        self.assertEqual(speakable("- un\n- deux\n\nFin."), "un. deux.")

    def test_further_paragraphs_stay_in_the_thread(self):
        self.assertEqual(speakable("Premier paragraphe.\n\nDeuxième paragraphe."), "Premier paragraphe.")

    def test_only_code_or_a_table_says_nothing(self):
        self.assertEqual(speakable("Oui, je t'entends bien ! \U0001f50a \u2014 le canal est bon."), "Oui, je t'entends bien ! \u2014 le canal est bon.")
        self.assertEqual(speakable("spécif \u2192 implé \u2192 tests \u2705"), "spécif, implé, tests.")
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


class CloneAndLimits(unittest.TestCase):
    def test_a_recording_cloned_at_the_provider(self):
        meta = parse_job_metadata(json.dumps({"voice": {"custom": True, "remote": {"provider": "elevenlabs", "id": "RemoteVoice777"}}}), {})
        self.assertEqual(meta.voice, VoiceChoice(custom=True, remote_provider="elevenlabs", remote_id="RemoteVoice777"))

    def test_a_recording_that_was_not_cloned_or_a_bad_remote(self):
        for remote in (None, {}, {"provider": "other", "id": "RemoteVoice777"}, {"provider": "elevenlabs", "id": "../x"},
                       {"provider": "elevenlabs", "id": "x"}, {"provider": "elevenlabs", "id": 5}, "RemoteVoice777"):
            meta = parse_job_metadata(json.dumps({"voice": {"custom": True, "remote": remote}}), {})
            self.assertEqual(meta.voice, VoiceChoice(custom=True), remote)

    def test_limits(self):
        meta = parse_job_metadata(json.dumps({"limits": {"silenceMs": 180000, "maxMs": 1800000}}), {})
        self.assertEqual(meta.limits, CallLimits(180000, 1800000))
        self.assertEqual(parse_job_metadata("", {}).limits, CallLimits(300000, 3600000))
        for raw in ({"silenceMs": 5, "maxMs": 10 ** 12}, {"silenceMs": "x", "maxMs": None}, {"silenceMs": True}, "x", 5):
            self.assertEqual(parse_job_metadata(json.dumps({"limits": raw}), {}).limits, CallLimits(), raw)

    def test_the_waiting_phrase_is_in_the_calls_language(self):
        self.assertEqual(filler("fr"), "Un instant, je regarde.")
        self.assertEqual(filler("es-ES"), "Un momento, lo estoy mirando.")
        self.assertEqual(filler("sv"), filler("en"))
        self.assertEqual(filler(""), filler("en"))


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class State(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.state = CallState(self.clock)

    def test_words_while_nothing_runs_are_queued(self):
        self.assertFalse(self.state.busy())
        self.assertEqual(self.state.inject_mode(), "queue")

    def test_words_while_a_turn_runs_correct_it(self):
        self.state.turn_started()
        self.clock.t += 5
        self.assertTrue(self.state.busy())
        self.assertEqual(self.state.inject_mode(), "steer")
        self.state.turn_ended()
        self.assertEqual(self.state.inject_mode(), "queue")

    def test_a_turn_that_never_ends_cannot_trap_the_call(self):
        self.state.turn_started()
        self.clock.t += CallState.STALE_S + 1
        self.assertFalse(self.state.busy())
        self.assertEqual(self.state.inject_mode(), "queue")

    def test_one_moment_once_per_turn_and_only_if_nothing_was_said(self):
        self.state.turn_started()
        self.clock.t += 6
        self.assertFalse(self.state.wants_filler(), "an answer in a few seconds needs no \"one moment\"")
        self.clock.t += 5
        self.assertTrue(self.state.wants_filler())
        self.state.filler_said()
        self.assertFalse(self.state.wants_filler())
        self.state.turn_ended()
        self.state.turn_started()
        self.clock.t += 2
        self.state.reply_spoken()
        self.clock.t += 5
        self.assertFalse(self.state.wants_filler(), "the answer was already speaking")

    def test_no_filler_without_a_turn(self):
        self.clock.t += 100
        self.assertFalse(self.state.wants_filler())

    def test_a_call_ends_after_the_silence(self):
        limits = CallLimits(silence_ms=60000, max_ms=3600000)
        self.assertIsNone(self.state.expired(limits))
        self.clock.t += 61
        self.assertEqual(self.state.expired(limits), "silence")
        self.state.user_spoke()
        self.assertIsNone(self.state.expired(limits))

    def test_a_session_that_is_working_is_not_silence(self):
        limits = CallLimits(silence_ms=60000, max_ms=3600000)
        self.state.turn_started()
        self.clock.t += 90
        self.assertIsNone(self.state.expired(limits))

    def test_a_call_ends_at_its_maximum_length_even_if_the_user_keeps_talking(self):
        limits = CallLimits(silence_ms=60000, max_ms=300000)
        for _ in range(7):
            self.clock.t += 50
            self.state.user_spoke()
        self.assertEqual(self.state.expired(limits), "max")


if __name__ == "__main__":
    unittest.main(verbosity=1)
