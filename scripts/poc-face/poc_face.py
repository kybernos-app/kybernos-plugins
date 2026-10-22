#!/usr/bin/env python3
"""Proof of concept: which face provider can draw the assistant's face on a call?

For one provider, this puts a LiveKit agent in a throw-away room, makes it speak a known audio file through the provider's
avatar, and watches the video the way a browser would. It measures what decides the choice:

  join_s          how long the provider takes to join the room (avatar.start)
  first_motion_s  how long after the audio starts before the mouth region moves (a proxy for first speech on screen)
  width x height, fps   what the video really is
  lip_corr, lip_lag_s   how well the mouth motion follows the sound (Pearson, best lag): a sanity check, not a lip-sync score
  frames          three PNG frames (idle, speaking x2) for a human to judge the picture

It needs no LLM and no TTS: the audio is a WAV file given to `session.say(audio=...)`. Keys come from the environment or from
`<DSH home>/kybernos/livekit.env`; they are never printed. Nothing here is committed or shipped: it is a spike.

    python poc_face.py liveavatar --out ./out
    python poc_face.py anam --image portrait.png --out ./out      (once the adapter is wired, see ADAPTERS)

Run it with the call worker's own interpreter (it has livekit-agents) or a venv that has the provider's livekit plugin.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import subprocess
import sys
import time
import uuid
import wave
import zlib
from pathlib import Path

import numpy as np
from livekit import api, rtc
from livekit.agents import Agent, AgentSession, room_io
from livekit.agents.job import _JobContextVar
from livekit.agents.utils import http_context

SENTENCE = "Bonjour, je suis votre assistante. Voici un essai : je parle pendant quelques secondes, pour que l'on voie mes lèvres bouger."
SR = 24000


def say(msg: str) -> None:
    print(f"[poc {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def load_env() -> None:
    """The LiveKit line comes from the call bundle's own file; the providers under test keep theirs apart (poc-face.env), so the product's secrets stay the product's."""
    home = Path(os.environ.get("DSH_HOME") or Path.home() / ".dsh")
    for name in ("livekit.env", "poc-face.env"):
        f = home / "kybernos" / name
        if not f.exists():
            continue
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def need(*names: str) -> None:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise SystemExit("SKIP: missing " + ", ".join(missing))


class _Job:
    """The little a provider's plugin asks of a worker's job (who the local participant is): this script has no worker, so it answers that and nothing else."""

    def __init__(self, identity: str) -> None:
        self.local_participant_identity = identity
        self.shutdown_callbacks: list = []

    def add_shutdown_callback(self, callback, *args, **kwargs) -> None:
        self.shutdown_callbacks.append(callback)

    def token_claims(self):
        return type("Claims", (), {"identity": self.local_participant_identity})()


# ── ADAPTERS ── one function per provider: build the livekit AvatarSession. Wire a provider by adding it here. ──────────────
async def adapter_liveavatar(image: Path | None, result: dict):
    """A catalogue face (LiveAvatar's photo avatars need a paid add-on): this is the baseline of what runs today."""
    need("LIVEAVATAR_API_KEY", "LIVEAVATAR_AVATAR_ID")
    from livekit.plugins import liveavatar

    return liveavatar.AvatarSession(
        avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
        video_quality=os.getenv("LIVEAVATAR_QUALITY", "medium"),
        is_sandbox=os.getenv("LIVEAVATAR_SANDBOX", "0") == "1",
    )


async def adapter_anam(image: Path | None, result: dict):
    """Anam: the face is made once from the image (POST /v1/avatars, a couple of minutes), then reused by id (ANAM_AVATAR_ID)."""
    need("ANAM_API_KEY")
    import aiohttp
    from livekit.plugins import anam

    avatar_id = os.environ.get("ANAM_AVATAR_ID")
    if not avatar_id:
        if image is None:
            raise SystemExit("SKIP: give --image (or set ANAM_AVATAR_ID of a face made earlier)")
        t0 = time.monotonic()
        form = aiohttp.FormData()
        form.add_field("displayName", "poc-" + uuid.uuid4().hex[:6])
        form.add_field("imageFile", image.read_bytes(), filename=image.name, content_type="image/png" if image.suffix == ".png" else "image/jpeg")
        async with aiohttp.ClientSession() as http:
            async with http.post("https://api.anam.ai/v1/avatars", data=form, headers={"Authorization": "Bearer " + os.environ["ANAM_API_KEY"]}) as r:
                body = await r.json(content_type=None)
                if r.status != 201:
                    raise RuntimeError(f"avatar creation refused: HTTP {r.status} {json.dumps(body)[:300]}")
                avatar_id = body["id"]
        result["create_face_s"] = round(time.monotonic() - t0, 1)
        result["anam_avatar_id"] = avatar_id  # reuse it with ANAM_AVATAR_ID: the id is not a secret, the key is
    return anam.AvatarSession(persona_config=anam.PersonaConfig(name="poc", avatarId=avatar_id))


async def adapter_lemonslice(image: Path | None, result: dict):
    """LemonSlice: the image is an argument of the session itself (no creation step); the API needs a paid plan."""
    need("LEMONSLICE_API_KEY")
    from livekit.plugins import lemonslice

    if image is None:
        raise SystemExit("SKIP: give --image")
    from PIL import Image

    return lemonslice.AvatarSession(agent_image=Image.open(image).convert("RGB"), agent_idle_prompt="Calm, attentive, looks at the camera.")


async def adapter_runway(image: Path | None, result: dict):
    """Runway Characters: create the character once (dashboard or avatars.create with a reference image), then pass RUNWAY_AVATAR_ID."""
    need("RUNWAYML_API_SECRET", "RUNWAY_AVATAR_ID")
    from livekit.plugins import runway

    return runway.AvatarSession(avatar_id=os.environ["RUNWAY_AVATAR_ID"])


ADAPTERS = {"liveavatar": adapter_liveavatar, "anam": adapter_anam, "lemonslice": adapter_lemonslice, "runway": adapter_runway}


# ── audio ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def make_wav(path: Path, voice: str = "Amélie") -> Path:
    if path.exists():
        return path
    aiff = path.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-o", str(aiff), SENTENCE], check=True)
    subprocess.run(["afconvert", str(aiff), "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", "1", str(path)], check=True)
    aiff.unlink(missing_ok=True)
    return path


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2, "need 24 kHz mono 16-bit"
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


async def frames_of(pcm: np.ndarray):
    step = SR // 50  # 20 ms
    for i in range(0, len(pcm) - step + 1, step):
        chunk = pcm[i : i + step]
        yield rtc.AudioFrame(data=chunk.tobytes(), sample_rate=SR, num_channels=1, samples_per_channel=len(chunk))
        await asyncio.sleep(0.0)


# ── watching the video like a browser ──────────────────────────────────────────────────────────────────────────────────────
class Watcher:
    """Subscribes to the avatar's video and keeps, per frame, the time, the motion in the mouth region and a small picture."""

    def __init__(self) -> None:
        self.t: list[float] = []
        self.mouth: list[float] = []
        self.whole: list[float] = []
        self.shape: tuple[int, int] | None = None
        self.keep: list[tuple[float, np.ndarray]] = []  # (t, gray frame) every ~0.5 s
        self._prev: np.ndarray | None = None
        self.first: float | None = None
        self._last_keep = -1.0

    async def run(self, track: rtc.Track) -> None:
        stream = rtc.VideoStream(track)
        async for ev in stream:
            now = time.monotonic()
            if self.first is None:
                self.first = now
            f = ev.frame.convert(rtc.VideoBufferType.RGBA)
            h, w = f.height, f.width
            self.shape = (w, h)
            rgba = np.frombuffer(f.data, dtype=np.uint8).reshape(h, w, 4)
            gray = rgba[::4, ::4, :3].mean(axis=2).astype(np.float32)
            gh, gw = gray.shape
            if self._prev is not None and self._prev.shape == gray.shape:
                d = np.abs(gray - self._prev)
                self.whole.append(float(d.mean()))
                self.mouth.append(float(d[int(gh * 0.5) : int(gh * 0.92), int(gw * 0.25) : int(gw * 0.75)].mean()))
                self.t.append(now)
            self._prev = gray
            if now - self._last_keep > 0.5:
                self.keep.append((now, rgba[:, :, :3].copy()))
                self._last_keep = now


def write_png(path: Path, rgb: np.ndarray) -> None:
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def analyse(wt: Watcher, t_say: float, audio_s: float, pcm: np.ndarray) -> dict:
    out: dict = {"frames": len(wt.t)}
    if len(wt.t) < 10 or wt.shape is None:
        return {**out, "error": "no video received"}
    t = np.array(wt.t)
    mouth = np.array(wt.mouth)
    out["width"], out["height"] = wt.shape
    last = t[t > t[-1] - 5.0]
    out["fps"] = round(float(len(last) / max(last[-1] - last[0], 1e-6)), 1)
    pre = mouth[t < t_say]
    base_mu, base_sd = (float(pre.mean()), float(pre.std())) if len(pre) > 5 else (0.0, 0.0)
    out["idle_mouth_motion"] = round(base_mu, 3)
    thr = max(base_mu + 4 * base_sd, base_mu + 0.5)
    win = (t >= t_say) & (t <= t_say + audio_s + 3)
    hot = np.where(win & (mouth > thr))[0]
    first = None
    for i in hot:
        if i + 2 < len(mouth) and (mouth[i : i + 3] > thr).all():
            first = float(t[i] - t_say)
            break
    out["first_motion_s"] = None if first is None else round(first, 2)
    # lip correlation: motion series vs the sound's loudness, best lag over 0..3 s
    hz = 25.0
    grid = np.arange(t_say, t_say + audio_s + 3, 1 / hz)
    m = np.interp(grid, t, mouth)
    n = int(len(pcm) / SR * hz)
    env = np.array([np.sqrt(np.mean(pcm[int(i * SR / hz) : int((i + 1) * SR / hz)].astype(np.float64) ** 2)) for i in range(n)])
    best = (-2.0, 0.0)
    for lag in range(0, int(3 * hz)):
        seg = m[lag : lag + n]
        if len(seg) < n or seg.std() < 1e-6 or env.std() < 1e-6:
            continue
        c = float(np.corrcoef(seg, env)[0, 1])
        if c > best[0]:
            best = (c, lag / hz)
    out["lip_corr"] = round(best[0], 2) if best[0] > -2 else None
    out["lip_lag_s"] = round(best[1], 2)
    return out


async def run(provider: str, image: Path | None, wav: Path, out_dir: Path, tail: float) -> dict:
    load_env()
    need("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
    if provider not in ADAPTERS:
        raise SystemExit(f"SKIP: no adapter for '{provider}' yet (see ADAPTERS in this file)")
    pcm = read_wav(wav)
    audio_s = len(pcm) / SR
    url, key, secret = os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"]
    room_name = "poc-face-" + uuid.uuid4().hex[:8]

    def token(identity: str) -> str:
        return api.AccessToken(key, secret).with_identity(identity).with_grants(api.VideoGrants(room_join=True, room=room_name)).to_jwt()

    watcher_room = rtc.Room()
    wt = Watcher()
    tasks: list[asyncio.Task] = []

    @watcher_room.on("track_subscribed")
    def _sub(track: rtc.Track, pub, participant) -> None:
        if track.kind == rtc.TrackKind.KIND_VIDEO and participant.identity != "poc-watcher":
            tasks.append(asyncio.create_task(wt.run(track)))

    await watcher_room.connect(url, token("poc-watcher"))
    agent_room = rtc.Room()
    await agent_room.connect(url, token("poc-agent"))
    session = AgentSession()
    result: dict = {"provider": provider, "audio_s": round(audio_s, 1)}
    avatar = None
    try:
        avatar = await ADAPTERS[provider](image, result)
        t0 = time.monotonic()
        say("joining the provider…")
        job_token = _JobContextVar.set(_Job(agent_room.local_participant.identity))
        try:
            await asyncio.wait_for(avatar.start(session, room=agent_room), 60)
        finally:
            _JobContextVar.reset(job_token)
        result["join_s"] = round(time.monotonic() - t0, 2)
        say(f"joined in {result['join_s']} s; video tracks so far: {len(tasks)}")
        await session.start(agent=Agent(instructions="Say what you are given."), room=agent_room, room_output_options=room_io.RoomOutputOptions(audio_enabled=False))
        await asyncio.sleep(4.0)  # idle picture: the baseline of mouth motion
        say(f"idle frames: {len(wt.t)}")
        if wt.first is not None:
            result["first_frame_s"] = round(wt.first - t0, 2)  # from the start of the provider join to the first picture of its video
        t_say = time.monotonic()
        handle = session.say(SENTENCE, audio=frames_of(pcm), add_to_chat_ctx=False)
        try:
            await asyncio.wait_for(handle.wait_for_playout(), audio_s + 25)
        except asyncio.TimeoutError:
            result["playout"] = "did not finish"
        await asyncio.sleep(tail)
        result.update(analyse(wt, t_say, audio_s, pcm))
        # three pictures for a human: before speech, and the two moments of strongest mouth motion
        out_dir.mkdir(parents=True, exist_ok=True)
        pic = [(t, f) for t, f in wt.keep]
        idle = [p for p in pic if p[0] < t_say]
        talk = sorted([p for p in pic if t_say <= p[0] <= t_say + audio_s], key=lambda p: -float(np.abs(np.diff(p[1][::8, ::8, 0].astype(np.float32), axis=0)).mean()))
        for name, p in [("idle", idle[-1] if idle else None), ("talk1", talk[0] if talk else None), ("talk2", talk[1] if len(talk) > 1 else None)]:
            if p is not None:
                write_png(out_dir / f"{provider}-{name}.png", p[1])
    except SystemExit:
        raise
    except Exception as e:  # a provider that fails is a result, not a crash
        result["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        try:
            await asyncio.wait_for(session.aclose(), 10)
        except Exception:
            pass
        for task in tasks:
            task.cancel()
        await agent_room.disconnect()
        await watcher_room.disconnect()
        try:
            lk = api.LiveKitAPI(url, key, secret)
            await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
            await lk.aclose()
        except Exception:
            pass
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("provider", choices=sorted(ADAPTERS) or None)
    ap.add_argument("--image", type=Path, help="the portrait, for providers that draw a face from one image")
    ap.add_argument("--wav", type=Path, help="24 kHz mono 16-bit WAV to speak (default: made with macOS `say`)")
    ap.add_argument("--out", type=Path, default=Path("poc-face-out"))
    ap.add_argument("--tail", type=float, default=2.0, help="seconds to keep watching after the audio ends")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    wav = make_wav(a.wav or a.out / "sentence.wav")
    async def inside_http_context() -> dict:
        # The provider plugins share one aiohttp session that the agent worker normally opens for them.
        async with http_context.open():
            return await run(a.provider, a.image, wav, a.out, a.tail)

    res = asyncio.run(inside_http_context())
    (a.out / f"{a.provider}.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
