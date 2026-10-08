"""The worker's LiveKit-facing behaviour: who answers. Needs livekit-agents (the worker's venv); skipped without it.

    <venv>/bin/python test_call_agent.py
"""

import asyncio
import os
import unittest

os.environ.setdefault("GROQ_API_KEY", "test-key-not-used")

try:
    import agent as worker
    from livekit.agents import StopResponse
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


if __name__ == "__main__":
    unittest.main(verbosity=1)
